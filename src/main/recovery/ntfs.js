// NTFS: finds deleted files by reading the Master File Table directly
const { typeOf, allocatedFraction, chanceFrom, yieldLoop } = require('./common');

function applyFixup(buf, recSize) {
  const usaOff = buf.readUInt16LE(4);
  const usaCount = buf.readUInt16LE(6);
  if (usaOff + usaCount * 2 > recSize) return false;
  const usn = buf.readUInt16LE(usaOff);
  for (let i = 1; i < usaCount; i++) {
    const pos = i * 512 - 2;
    if (pos + 2 > recSize) break;
    if (buf.readUInt16LE(pos) !== usn) return false;
    buf.writeUInt16LE(buf.readUInt16LE(usaOff + i * 2), pos);
  }
  return true;
}

function readRunlist(buf, off, end) {
  const runs = [];
  let lcn = 0;
  while (off < end) {
    const h = buf[off];
    if (h === 0) break;
    const lenSize = h & 0x0F, offSize = h >> 4;
    off++;
    let len = 0;
    for (let i = 0; i < lenSize; i++) len += buf[off + i] * Math.pow(256, i);
    off += lenSize;
    if (offSize === 0) { runs.push({ lcn: null, len }); continue; }
    let delta = 0;
    for (let i = 0; i < offSize; i++) delta += buf[off + i] * Math.pow(256, i);
    if (buf[off + offSize - 1] & 0x80) delta -= Math.pow(256, offSize);
    off += offSize;
    lcn += delta;
    runs.push({ lcn, len });
  }
  return runs;
}

function filetime(buf, off) {
  const ft = buf.readBigUInt64LE(off);
  if (ft === 0n) return 0;
  return Number(ft / 10000n) - 11644473600000;
}

function parseRecord(buf, recSize) {
  if (buf.toString('ascii', 0, 4) !== 'FILE') return null;
  if (!applyFixup(buf, recSize)) return null;
  const flags = buf.readUInt16LE(0x16);
  const base = Number(buf.readBigUInt64LE(0x20) & 0xFFFFFFFFFFFFn);
  const out = { inUse: !!(flags & 1), isDir: !!(flags & 2), base, name: null, rank: 99, parent: 0, ctime: 0, mtime: 0, runs: null, size: 0, resident: null, attrList: false };
  let off = buf.readUInt16LE(0x14);
  let guard = 0;
  while (off + 16 < recSize && guard++ < 64) {
    const type = buf.readUInt32LE(off);
    if (type === 0xFFFFFFFF || type === 0) break;
    const len = buf.readUInt32LE(off + 4);
    if (len < 16 || off + len > recSize) break;
    const nonRes = buf[off + 8];
    const nameLen = buf[off + 9];
    if (type === 0x20) out.attrList = true;
    if (type === 0x30 && !nonRes) {
      const co = off + buf.readUInt16LE(off + 0x14);
      const ns = buf[co + 0x41];
      const rank = ns === 1 || ns === 3 ? 0 : ns === 0 ? 1 : 2; // Win32 > POSIX > DOS 8.3
      if (rank < out.rank) {
        out.rank = rank;
        out.name = buf.toString('utf16le', co + 0x42, co + 0x42 + buf[co + 0x40] * 2);
        out.parent = Number(buf.readBigUInt64LE(co) & 0xFFFFFFFFFFFFn);
        out.ctime = filetime(buf, co + 0x08);
        out.mtime = filetime(buf, co + 0x10);
      }
    }
    if (type === 0x80 && nameLen === 0) {
      if (nonRes) {
        if (Number(buf.readBigUInt64LE(off + 0x10)) === 0) {
          out.runs = readRunlist(buf, off + buf.readUInt16LE(off + 0x20), off + len);
          out.size = Number(buf.readBigUInt64LE(off + 0x30));
        }
      } else {
        const cs = buf.readUInt32LE(off + 0x10), co = buf.readUInt16LE(off + 0x14);
        out.resident = Buffer.from(buf.subarray(off + co, off + co + cs));
        out.size = cs;
      }
    }
    off += len;
  }
  return out;
}

function info(vol) {
  const bs = vol.read(0, 512);
  if (bs.toString('ascii', 3, 11) !== 'NTFS    ') throw new Error('Il volume non è NTFS');
  const bps = bs.readUInt16LE(0x0B), spc = bs.readUInt8(0x0D);
  const clusterSize = bps * spc;
  const c = bs.readInt8(0x40);
  const recordSize = c > 0 ? c * clusterSize : Math.pow(2, -c);
  const totalSectors = Number(bs.readBigUInt64LE(0x28));
  vol.sectorSize = bps;
  vol.size = vol.size || totalSectors * bps;
  return { clusterSize, recordSize, mftCluster: Number(bs.readBigUInt64LE(0x30)), totalClusters: Math.floor(totalSectors / spc) };
}

async function readRecordData(vol, rec, clusterSize) {
  if (!rec || !rec.runs) return null;
  const parts = [];
  for (const r of rec.runs) parts.push(r.lcn == null ? Buffer.alloc(r.len * clusterSize) : Buffer.from(await vol.readAsync(r.lcn * clusterSize, r.len * clusterSize)));
  return Buffer.concat(parts);
}

/** Bitmap of allocated clusters ($Bitmap, MFT record 6) */
async function loadBitmap(vol, nfo, mftRuns) {
  const rec = await readMftRecord(vol, nfo, mftRuns, 6);
  return readRecordData(vol, rec, nfo.clusterSize);
}

async function readMftRecord(vol, nfo, mftRuns, n) {
  const byteOff = n * nfo.recordSize;
  let pos = 0;
  for (const run of mftRuns) {
    const bytes = run.len * nfo.clusterSize;
    if (byteOff < pos + bytes) return parseRecord(Buffer.from(await vol.readAsync(run.lcn * nfo.clusterSize + (byteOff - pos), nfo.recordSize)), nfo.recordSize);
    pos += bytes;
  }
  return null;
}

function toExtents(runs, clusterSize) {
  return runs.map((r) => ({ off: r.lcn == null ? null : r.lcn * clusterSize, len: r.len * clusterSize }));
}

/**
 * Scan for deleted files.
 * @returns {{items:Array, bitmap:Buffer, clusterSize:number}}
 */
async function scan(vol, ctx) {
  const nfo = info(vol);
  const rec0 = parseRecord(Buffer.from(vol.read(nfo.mftCluster * nfo.clusterSize, nfo.recordSize)), nfo.recordSize);
  if (!rec0 || !rec0.runs) throw new Error('Impossibile leggere la Master File Table');
  const mftRuns = rec0.runs;
  const totalRecords = Math.floor(rec0.size / nfo.recordSize);
  ctx.progress({ percent: 1, label: 'Lettura della mappa dei cluster…' });
  const bitmap = await loadBitmap(vol, nfo, mftRuns);
  const isAlloc = (c) => bitmap ? !!(bitmap[c >> 3] & (1 << (c & 7))) : false;
  const dirs = new Map();
  const items = [];
  let recNo = 0;
  const BATCH = 4 * 1024 * 1024;
  for (const run of mftRuns) {
    if (run.lcn == null) { recNo += Math.floor(run.len * nfo.clusterSize / nfo.recordSize); continue; }
    const runBytes = run.len * nfo.clusterSize;
    for (let off = 0; off < runBytes; off += BATCH) {
      if (ctx.cancelled()) break;
      const len = Math.min(BATCH, runBytes - off);
      const chunk = Buffer.from(await vol.readAsync(run.lcn * nfo.clusterSize + off, len, true));
      for (let p = 0; p + nfo.recordSize <= len; p += nfo.recordSize, recNo++) {
        if (recNo >= totalRecords) break;
        const r = parseRecord(chunk.subarray(p, p + nfo.recordSize), nfo.recordSize);
        if (!r || !r.name || r.base !== 0) continue;
        if (r.isDir) { dirs.set(recNo, { name: r.name, parent: r.parent, inUse: r.inUse }); continue; }
        if (r.inUse || recNo < 24) continue;
        const hasData = !!(r.resident || (r.runs && r.runs.length) || r.size === 0);
        let frac = 0;
        if (r.runs && r.runs.length) frac = allocatedFraction(isAlloc, r.runs.filter((x) => x.lcn != null).map((x) => [x.lcn, x.len]));
        let chance = chanceFrom(frac, hasData);
        if (chance === 'excellent' && r.attrList) chance = 'average';
        items.push({
          name: r.name, parent: r.parent, size: r.size, mtime: r.mtime, ctime: r.ctime, type: typeOf(r.name), chance, source: 'mft',
          extents: r.runs ? toExtents(r.runs, nfo.clusterSize) : [], resident: r.resident ? r.resident.toString('base64') : null
        });
      }
      ctx.progress({ percent: Math.min(99, Math.round((recNo / totalRecords) * 100)), label: `Analisi della Master File Table… ${items.length} file eliminati trovati` });
      await yieldLoop();
    }
    if (ctx.cancelled()) break;
  }
  const cache = new Map();
  const root = vol.src.letter ? vol.src.letter.toUpperCase() + ':' : '';
  function dirPath(n, depth = 0) {
    if (n === 5) return root;
    if (cache.has(n)) return cache.get(n);
    const d = dirs.get(n);
    const p = !d || depth > 64 ? root + '\\<cartella sconosciuta>' : dirPath(d.parent, depth + 1) + '\\' + d.name;
    cache.set(n, p);
    return p;
  }
  for (const it of items) { it.folder = dirPath(it.parent) || '\\'; delete it.parent; }
  return { items, clusterSize: nfo.clusterSize, isFree: (c) => !isAlloc(c), totalClusters: nfo.totalClusters, dataOffset: 0 };
}

module.exports = { scan, info };
