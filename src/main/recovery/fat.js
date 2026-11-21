// FAT12/16/32 and exFAT: finds deleted directory entries (SD cards, USB sticks, cameras)
const { typeOf, dosTime, allocatedFraction, chanceFrom, yieldLoop } = require('./common');

const MAX_FAT_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------- FAT12/16/32
function fatInfo(vol) {
  const b = vol.read(0, 512);
  const bps = b.readUInt16LE(0x0B), spc = b[0x0D], reserved = b.readUInt16LE(0x0E), nFats = b[0x10];
  const rootEnt = b.readUInt16LE(0x11);
  const tot = b.readUInt16LE(0x13) || b.readUInt32LE(0x20);
  const fatSz = b.readUInt16LE(0x16) || b.readUInt32LE(0x24);
  const rootDirSectors = Math.ceil((rootEnt * 32) / bps);
  const firstData = reserved + nFats * fatSz + rootDirSectors;
  const clusterCount = Math.floor((tot - firstData) / spc);
  const kind = rootEnt === 0 ? 32 : clusterCount < 4085 ? 12 : 16;
  vol.sectorSize = bps;
  vol.size = vol.size || tot * bps;
  return { bps, spc, clusterSize: bps * spc, fatOffset: reserved * bps, fatBytes: fatSz * bps, rootDirOffset: (reserved + nFats * fatSz) * bps, rootDirBytes: rootDirSectors * bps, dataOffset: firstData * bps, clusterCount, kind, rootCluster: kind === 32 ? b.readUInt32LE(0x2C) : 0 };
}

function makeFatReader(nfo, fat) {
  return (c) => {
    if (nfo.kind === 32) return fat.readUInt32LE(c * 4) & 0x0FFFFFFF;
    if (nfo.kind === 16) return fat.readUInt16LE(c * 2);
    const o = Math.floor(c * 1.5);
    const v = fat.readUInt16LE(o);
    return c & 1 ? v >> 4 : v & 0x0FFF;
  };
}

function lfnChars(e) {
  const parts = [e.subarray(1, 11), e.subarray(14, 26), e.subarray(28, 32)];
  let s = '';
  for (const p of parts) for (let i = 0; i + 1 < p.length; i += 2) { const ch = p.readUInt16LE(i); if (ch === 0 || ch === 0xFFFF) return { s, end: true }; s += String.fromCharCode(ch); }
  return { s, end: false };
}

async function scanFat(vol, ctx) {
  const nfo = fatInfo(vol);
  if (nfo.fatBytes > MAX_FAT_BYTES) throw new Error('Tabella FAT troppo grande per essere analizzata');
  ctx.progress({ percent: 2, label: 'Lettura della tabella FAT…' });
  const fat = Buffer.from(await vol.readAsync(nfo.fatOffset, nfo.fatBytes, true));
  const next = makeFatReader(nfo, fat);
  const isAlloc = (c) => c >= 2 && c < nfo.clusterCount + 2 && next(c) !== 0;
  const cOff = (c) => nfo.dataOffset + (c - 2) * nfo.clusterSize;
  const eoc = nfo.kind === 32 ? 0x0FFFFFF8 : nfo.kind === 16 ? 0xFFF8 : 0xFF8;
  const chain = (c) => { const out = []; const seen = new Set(); while (c >= 2 && c < eoc && !seen.has(c) && out.length < 1e6) { seen.add(c); out.push(c); c = next(c); } return out; };
  const items = [];
  let dirsDone = 0;
  const queue = [];
  if (nfo.kind === 32) queue.push({ clusters: chain(nfo.rootCluster), path: '' });
  else queue.push({ fixed: true, path: '' });
  const visited = new Set();
  while (queue.length && !ctx.cancelled()) {
    const d = queue.shift();
    let data;
    if (d.fixed) data = Buffer.from(await vol.readAsync(nfo.rootDirOffset, nfo.rootDirBytes, true));
    else {
      const key = d.clusters[0];
      if (!key || visited.has(key)) continue;
      visited.add(key);
      const parts = [];
      for (const c of d.clusters.slice(0, 4096)) parts.push(Buffer.from(await vol.readAsync(cOff(c), nfo.clusterSize, true)));
      data = Buffer.concat(parts);
    }
    let lfn = [];
    for (let o = 0; o + 32 <= data.length; o += 32) {
      const e = data.subarray(o, o + 32);
      if (e[0] === 0x00) break;
      const attr = e[11];
      if (attr === 0x0F) { lfn.push(e); continue; }
      const deleted = e[0] === 0xE5;
      let name;
      if (lfn.length) {
        let s = '';
        for (let i = lfn.length - 1; i >= 0; i--) s += lfnChars(lfn[i]).s;
        name = s;
      }
      lfn = [];
      if (attr & 0x08) continue; // volume label
      let base = e.toString('latin1', 0, 8).trimEnd(), ext = e.toString('latin1', 8, 11).trimEnd();
      if (e[12] & 0x08) base = base.toLowerCase(); // NT: name stored lowercase
      if (e[12] & 0x10) ext = ext.toLowerCase();
      if (base === '.' || base === '..') continue;
      if (!name) name = (deleted ? '_' + base.slice(1) : base) + (ext ? '.' + ext : '');
      const first = (nfo.kind === 32 ? e.readUInt16LE(20) << 16 : 0) | e.readUInt16LE(26);
      const size = e.readUInt32LE(28);
      const isDir = !!(attr & 0x10);
      const folder = (vol.src.letter ? vol.src.letter.toUpperCase() + ':' : '') + d.path;
      if (isDir) {
        if (first < 2) continue;
        if (!deleted) queue.push({ clusters: chain(first), path: d.path + '\\' + name });
        else if (!isAlloc(first)) {
          // deleted folder: assume contiguous clusters (up to 64)
          const cl = [];
          for (let c = first; c < first + 64 && !isAlloc(c); c++) cl.push(c);
          queue.push({ clusters: cl, path: d.path + '\\' + name + ' (eliminata)' });
        }
        continue;
      }
      if (!deleted) continue;
      const count = Math.ceil(size / nfo.clusterSize);
      const valid = first >= 2 && first + count <= nfo.clusterCount + 2;
      const frac = valid && count ? allocatedFraction(isAlloc, [[first, count]]) : 0;
      items.push({
        name, folder: folder || '\\', size, mtime: dosTime(e.readUInt16LE(24), e.readUInt16LE(22)), ctime: dosTime(e.readUInt16LE(16), e.readUInt16LE(14)),
        type: typeOf(name), chance: size === 0 ? 'excellent' : chanceFrom(frac, valid), source: 'fat',
        extents: valid && count ? [{ off: cOff(first), len: count * nfo.clusterSize }] : []
      });
    }
    dirsDone++;
    if (dirsDone % 20 === 0) { ctx.progress({ percent: -1, label: `Analisi delle cartelle… ${items.length} file eliminati trovati` }); await yieldLoop(); }
  }
  return { items, clusterSize: nfo.clusterSize, isFree: (c) => !isAlloc(c + 2), totalClusters: nfo.clusterCount, dataOffset: nfo.dataOffset };
}

// ---------------------------------------------------------------- exFAT
function exfatInfo(vol) {
  const b = vol.read(0, 512);
  const bps = 1 << b[0x6C], spc = 1 << b[0x6D];
  vol.sectorSize = bps;
  vol.size = vol.size || Number(b.readBigUInt64LE(0x48)) * bps;
  return { bps, clusterSize: bps * spc, fatOffset: b.readUInt32LE(0x50) * bps, fatBytes: b.readUInt32LE(0x54) * bps, heapOffset: b.readUInt32LE(0x58) * bps, clusterCount: b.readUInt32LE(0x5C), rootCluster: b.readUInt32LE(0x60) };
}

function exTime(v) { return v ? dosTime(v >>> 16, v & 0xFFFF) : 0; }

async function scanExfat(vol, ctx) {
  const nfo = exfatInfo(vol);
  if (nfo.fatBytes > MAX_FAT_BYTES) throw new Error('Tabella FAT troppo grande per essere analizzata');
  ctx.progress({ percent: 2, label: 'Lettura della tabella exFAT…' });
  const fat = Buffer.from(await vol.readAsync(nfo.fatOffset, nfo.fatBytes, true));
  const next = (c) => (c * 4 + 4 <= fat.length ? fat.readUInt32LE(c * 4) : 0xFFFFFFFF);
  const cOff = (c) => nfo.heapOffset + (c - 2) * nfo.clusterSize;
  const chain = (c, max = 1e6) => { const out = []; const seen = new Set(); while (c >= 2 && c < 0xFFFFFFF7 && !seen.has(c) && out.length < max) { seen.add(c); out.push(c); c = next(c); } return out; };
  const readClusters = async (clusters) => { const p = []; for (const c of clusters.slice(0, 4096)) p.push(Buffer.from(await vol.readAsync(cOff(c), nfo.clusterSize, true))); return Buffer.concat(p); };
  // allocation bitmap from the root directory
  const rootData = await readClusters(chain(nfo.rootCluster));
  let bitmap = null;
  for (let o = 0; o + 32 <= rootData.length; o += 32) {
    if (rootData[o] === 0x81) {
      const first = rootData.readUInt32LE(o + 20), len = Number(rootData.readBigUInt64LE(o + 24));
      bitmap = (await readClusters(chain(first))).subarray(0, len);
      break;
    }
  }
  const isAlloc = (c) => { if (!bitmap) return false; const i = c - 2; return !!(bitmap[i >> 3] & (1 << (i & 7))); };
  const items = [];
  const queue = [{ data: rootData, path: '' }];
  const visited = new Set([nfo.rootCluster]);
  let dirsDone = 0;
  while (queue.length && !ctx.cancelled()) {
    const d = queue.shift();
    const data = d.data || await readClusters(d.clusters);
    for (let o = 0; o + 32 <= data.length; o += 32) {
      const t = data[o];
      if (t === 0x00) break;
      if (t !== 0x85 && t !== 0x05) continue;
      const deleted = t === 0x05;
      const sec = data[o + 1];
      if (sec < 2 || o + 32 * (sec + 1) > data.length) continue;
      const attr = data.readUInt16LE(o + 4);
      const ctime = exTime(data.readUInt32LE(o + 8)), mtime = exTime(data.readUInt32LE(o + 12));
      const s = o + 32;
      if ((data[s] & 0x7F) !== 0x40) continue; // stream extension
      const flags = data[s + 1], nameLen = data[s + 3];
      const first = data.readUInt32LE(s + 20), size = Number(data.readBigUInt64LE(s + 24));
      let name = '';
      for (let k = 2; k <= sec; k++) {
        const n = o + 32 * k;
        if ((data[n] & 0x7F) !== 0x41) break;
        name += data.toString('utf16le', n + 2, n + 32);
      }
      name = name.slice(0, nameLen);
      o += 32 * sec;
      const count = Math.ceil(size / nfo.clusterSize);
      const contiguous = !!(flags & 0x02);
      let clusters = [];
      if (first >= 2 && count) {
        if (contiguous) clusters = [[first, count]];
        else {
          const ch = chain(first, count + 1);
          if (ch.length === count) {
            // compress into runs
            for (const c of ch) { const last = clusters[clusters.length - 1]; if (last && last[0] + last[1] === c) last[1]++; else clusters.push([c, 1]); }
          } else clusters = [[first, count]];
        }
      }
      const folder = (vol.src.letter ? vol.src.letter.toUpperCase() + ':' : '') + d.path;
      if (attr & 0x10) {
        if (first < 2 || visited.has(first)) continue;
        visited.add(first);
        if (!deleted) queue.push({ clusters: contiguous ? Array.from({ length: Math.max(1, count) }, (_, i) => first + i) : chain(first), path: d.path + '\\' + name });
        else if (!isAlloc(first)) queue.push({ clusters: Array.from({ length: Math.min(64, Math.max(1, count)) }, (_, i) => first + i), path: d.path + '\\' + name + ' (eliminata)' });
        continue;
      }
      if (!deleted) continue;
      const frac = clusters.length ? allocatedFraction(isAlloc, clusters) : 0;
      items.push({
        name, folder: folder || '\\', size, mtime, ctime, type: typeOf(name), source: 'exfat',
        chance: size === 0 ? 'excellent' : chanceFrom(frac, clusters.length > 0),
        extents: clusters.map(([c, n]) => ({ off: cOff(c), len: n * nfo.clusterSize }))
      });
    }
    dirsDone++;
    if (dirsDone % 20 === 0) { ctx.progress({ percent: -1, label: `Analisi delle cartelle… ${items.length} file eliminati trovati` }); await yieldLoop(); }
  }
  return { items, clusterSize: nfo.clusterSize, isFree: (c) => !isAlloc(c + 2), totalClusters: nfo.clusterCount, dataOffset: nfo.heapOffset };
}

module.exports = { scanFat, scanExfat, fatInfo, exfatInfo };
