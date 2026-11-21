// File Recovery: scans the NTFS Master File Table for deleted files and recovers their data clusters.
// Also lists/restores items from the Recycle Bin.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const ps = require('../ps');
const store = require('../store');

let cancelFlag = false;
let lastScan = null; // { letter, vol, items: [] }

class Volume {
  constructor(letter) {
    this.letter = letter.toUpperCase();
    this.fd = fs.openSync(`\\\\.\\${this.letter}:`, 'r');
  }
  close() { try { fs.closeSync(this.fd); } catch (e) {} }
  readRaw(offset, length) {
    // offsets/lengths must be sector-aligned for raw volume access
    const ss = this.bytesPerSector || 512;
    const start = Math.floor(offset / ss) * ss;
    const end = Math.ceil((offset + length) / ss) * ss;
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(this.fd, buf, got, buf.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(offset - start, offset - start + length);
  }
  async readRawAsync(offset, length) {
    const ss = this.bytesPerSector || 512;
    const start = Math.floor(offset / ss) * ss;
    const end = Math.ceil((offset + length) / ss) * ss;
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await new Promise((res, rej) => fs.read(this.fd, buf, got, buf.length - got, start + got, (err, bytesRead) => err ? rej(err) : res({ bytesRead })));
      if (bytesRead <= 0) break;
      got += bytesRead;
    }
    return buf.subarray(offset - start, offset - start + length);
  }
  init() {
    const bs = this.readRaw(0, 512);
    if (bs.toString('ascii', 3, 11) !== 'NTFS    ') throw new Error('Il recupero file supporta solo unità NTFS.');
    this.bytesPerSector = bs.readUInt16LE(0x0B);
    this.sectorsPerCluster = bs.readUInt8(0x0D);
    this.clusterSize = this.bytesPerSector * this.sectorsPerCluster;
    this.mftCluster = Number(bs.readBigUInt64LE(0x30));
    const c = bs.readInt8(0x40);
    this.recordSize = c > 0 ? c * this.clusterSize : Math.pow(2, -c);
    this.totalSectors = Number(bs.readBigUInt64LE(0x28));
    this.totalClusters = Math.floor(this.totalSectors / this.sectorsPerCluster);
    const rec0 = this.readRaw(this.mftCluster * this.clusterSize, this.recordSize);
    const r = parseRecord(Buffer.from(rec0), this.recordSize);
    if (!r || !r.dataRuns) throw new Error('Impossibile leggere la MFT.');
    this.mftRuns = r.dataRuns;
    this.mftSize = r.dataSize;
  }
}

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
    if (offSize === 0) { runs.push({ lcn: null, len }); continue; } // sparse
    let delta = 0;
    for (let i = 0; i < offSize; i++) delta += buf[off + i] * Math.pow(256, i);
    if (buf[off + offSize - 1] & 0x80) delta -= Math.pow(256, offSize);
    off += offSize;
    lcn += delta;
    runs.push({ lcn, len });
  }
  return runs;
}

function filetimeToMs(buf, off) {
  const ft = buf.readBigUInt64LE(off);
  if (ft === 0n) return 0;
  return Number(ft / 10000n) - 11644473600000;
}

/** Parse an MFT record (fixup is applied in place). */
function parseRecord(buf, recSize) {
  if (buf.toString('ascii', 0, 4) !== 'FILE') return null;
  if (!applyFixup(buf, recSize)) return null;
  const flags = buf.readUInt16LE(0x16);
  const baseRef = Number(buf.readBigUInt64LE(0x20) & 0xFFFFFFFFFFFFn);
  const out = { inUse: !!(flags & 1), isDir: !!(flags & 2), base: baseRef, name: null, nameNs: 99, parent: 0, ctime: 0, mtime: 0, dataRuns: null, dataSize: 0, resident: null, hasAttrList: false };
  let off = buf.readUInt16LE(0x14);
  let guard = 0;
  while (off + 16 < recSize && guard++ < 64) {
    const type = buf.readUInt32LE(off);
    if (type === 0xFFFFFFFF || type === 0) break;
    const len = buf.readUInt32LE(off + 4);
    if (len < 16 || off + len > recSize) break;
    const nonRes = buf[off + 8];
    const nameLen = buf[off + 9];
    if (type === 0x20) out.hasAttrList = true;
    if (type === 0x30 && !nonRes) {
      const co = off + buf.readUInt16LE(off + 0x14);
      const parent = Number(buf.readBigUInt64LE(co) & 0xFFFFFFFFFFFFn);
      const fnLen = buf[co + 0x40];
      const ns = buf[co + 0x41];
      // prefer Win32 (1) / Win32&DOS (3) over POSIX (0) over DOS (2)
      const rank = ns === 1 || ns === 3 ? 0 : ns === 0 ? 1 : 2;
      if (rank < out.nameNs) {
        out.nameNs = rank;
        out.name = buf.toString('utf16le', co + 0x42, co + 0x42 + fnLen * 2);
        out.parent = parent;
        out.ctime = filetimeToMs(buf, co + 0x08);
        out.mtime = filetimeToMs(buf, co + 0x10);
      }
    }
    if (type === 0x80 && nameLen === 0) {
      if (nonRes) {
        const startVcn = Number(buf.readBigUInt64LE(off + 0x10));
        if (startVcn === 0) {
          const roff = buf.readUInt16LE(off + 0x20);
          out.dataRuns = readRunlist(buf, off + roff, off + len);
          out.dataSize = Number(buf.readBigUInt64LE(off + 0x30));
        }
      } else {
        const cs = buf.readUInt32LE(off + 0x10);
        const co = buf.readUInt16LE(off + 0x14);
        out.resident = Buffer.from(buf.subarray(off + co, off + co + cs));
        out.dataSize = cs;
      }
    }
    off += len;
  }
  return out;
}

const TYPES = {
  image: /\.(jpe?g|png|gif|bmp|tiff?|webp|heic|raw|cr2|nef|arw|dng|psd|svg|ico)$/i,
  document: /\.(docx?|xlsx?|pptx?|pdf|txt|rtf|odt|ods|odp|csv|md|xml|json|html?|eml|msg|pub|one)$/i,
  video: /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpe?g|3gp|ts)$/i,
  music: /\.(mp3|wav|flac|aac|ogg|wma|m4a|opus|aiff?)$/i,
  archive: /\.(zip|rar|7z|tar|gz|bz2|xz|iso|cab)$/i
};
function typeOf(name) { for (const [k, re] of Object.entries(TYPES)) if (re.test(name)) return k; return 'other'; }

async function drives() {
  const r = await ps.json(`
$o = @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 -and $_.Size -gt 0 } | ForEach-Object { @{ letter = $_.DeviceID.Substring(0,1); fs = $_.FileSystem; label = $_.VolumeName; size = [int64]$_.Size; free = [int64]$_.FreeSpace; removable = ($_.DriveType -eq 2) } })
Emit-Result $o`);
  return ps.arr(r);
}

async function loadBitmap(vol) {
  // $Bitmap is MFT record 6
  const rec = await readMftRecord(vol, 6);
  if (!rec || !rec.dataRuns) return null;
  const parts = [];
  for (const run of rec.dataRuns) {
    if (run.lcn == null) { parts.push(Buffer.alloc(run.len * vol.clusterSize)); continue; }
    parts.push(Buffer.from(await vol.readRawAsync(run.lcn * vol.clusterSize, run.len * vol.clusterSize)));
  }
  return Buffer.concat(parts);
}

async function readMftRecord(vol, n) {
  const byteOff = n * vol.recordSize;
  let vcnBytes = 0;
  for (const run of vol.mftRuns) {
    const runBytes = run.len * vol.clusterSize;
    if (byteOff < vcnBytes + runBytes) {
      const disk = run.lcn * vol.clusterSize + (byteOff - vcnBytes);
      const b = Buffer.from(await vol.readRawAsync(disk, vol.recordSize));
      return parseRecord(b, vol.recordSize);
    }
    vcnBytes += runBytes;
  }
  return null;
}

function clustersAllocated(bitmap, runs) {
  if (!bitmap) return 0;
  let total = 0, used = 0;
  for (const r of runs) {
    if (r.lcn == null) continue;
    const step = Math.max(1, Math.floor(r.len / 64)); // sample long runs
    for (let c = r.lcn; c < r.lcn + r.len; c += step) {
      total++;
      if (bitmap[c >> 3] & (1 << (c & 7))) used++;
    }
  }
  return total ? used / total : 0;
}

async function scan(opts, ctx = {}) {
  cancelFlag = false;
  const letter = opts.letter.toUpperCase();
  const vol = new Volume(letter);
  try {
    vol.init();
    if (ctx.progress) ctx.progress({ percent: 1, label: 'Lettura della mappa dei cluster…' });
    const bitmap = await loadBitmap(vol);
    const dirs = new Map(); // recNo -> {name,parent}
    const deleted = [];
    const totalRecords = Math.floor(vol.mftSize / vol.recordSize);
    let recNo = 0;
    const BATCH = 4 * 1024 * 1024;
    for (const run of vol.mftRuns) {
      if (run.lcn == null) { recNo += Math.floor(run.len * vol.clusterSize / vol.recordSize); continue; }
      const runBytes = run.len * vol.clusterSize;
      for (let off = 0; off < runBytes; off += BATCH) {
        if (cancelFlag) break;
        const len = Math.min(BATCH, runBytes - off);
        const chunk = Buffer.from(await vol.readRawAsync(run.lcn * vol.clusterSize + off, len));
        for (let p = 0; p + vol.recordSize <= len; p += vol.recordSize, recNo++) {
          if (recNo >= totalRecords) break;
          const rb = chunk.subarray(p, p + vol.recordSize);
          const r = parseRecord(rb, vol.recordSize);
          if (!r || !r.name || r.base !== 0) continue;
          if (r.isDir) { dirs.set(recNo, { name: r.name, parent: r.parent, inUse: r.inUse }); continue; }
          if (r.inUse) continue;
          if (recNo < 24) continue;
          if (/^~\$|\.tmp$|^~.*\.tmp$/i.test(r.name)) { if (!opts.includeTemp) continue; }
          const recoverable = !!(r.resident || (r.dataRuns && r.dataRuns.length));
          let overwritten = 0;
          if (r.dataRuns && r.dataRuns.length) overwritten = clustersAllocated(bitmap, r.dataRuns);
          let chance = 'excellent';
          if (!recoverable && r.dataSize > 0) chance = 'none';
          else if (overwritten > 0.99) chance = 'poor';
          else if (overwritten > 0) chance = 'average';
          else if (r.hasAttrList) chance = 'average';
          deleted.push({ rec: recNo, name: r.name, parent: r.parent, size: r.dataSize, mtime: r.mtime, ctime: r.ctime, type: typeOf(r.name), chance, runs: r.dataRuns, resident: r.resident ? r.resident.toString('base64') : null });
        }
        if (ctx.progress) ctx.progress({ percent: Math.min(99, Math.round((recNo / totalRecords) * 100)), label: `Analisi della MFT… ${deleted.length} file eliminati trovati` });
        await new Promise((r) => setImmediate(r));
      }
      if (cancelFlag) break;
    }
    // build folder paths
    const pathCache = new Map();
    function dirPath(n, depth = 0) {
      if (n === 5) return letter + ':';
      if (pathCache.has(n)) return pathCache.get(n);
      const d = dirs.get(n);
      if (!d || depth > 64) return letter + ':\\<cartella sconosciuta>';
      const p = dirPath(d.parent, depth + 1) + '\\' + d.name + (d.inUse ? '' : '');
      pathCache.set(n, p);
      return p;
    }
    for (const it of deleted) { it.folder = dirPath(it.parent); it.path = it.folder + '\\' + it.name; }
    lastScan = { letter, items: deleted, clusterSize: vol.clusterSize, recordSize: vol.recordSize };
    const items = deleted.map((d, i) => ({ i, name: d.name, folder: d.folder, size: d.size, mtime: d.mtime, type: d.type, chance: d.chance }));
    return { letter, count: items.length, items, cancelled: cancelFlag };
  } finally { vol.close(); }
}

async function recover(opts, ctx = {}) {
  if (!lastScan) throw new Error('Esegui prima una scansione.');
  const dest = opts.destination;
  if (!dest) throw new Error('Seleziona una cartella di destinazione.');
  if (dest[0].toUpperCase() === lastScan.letter) {
    if (!opts.allowSameDrive) return { needConfirmSameDrive: true };
  }
  const vol = new Volume(lastScan.letter);
  vol.init();
  let ok = 0; const failed = [];
  try {
    let n = 0;
    for (const idx of opts.indexes) {
      n++;
      const it = lastScan.items[idx];
      if (!it) continue;
      if (ctx.progress) ctx.progress({ percent: Math.round((n / opts.indexes.length) * 100), label: `Recupero di ${it.name}…` });
      const rel = opts.keepStructure ? it.folder.replace(/^[A-Z]:\\?/i, '').replace(/[<>:"|?*]/g, '_') : '';
      const outDir = path.join(dest, rel);
      await fsp.mkdir(outDir, { recursive: true });
      let target = path.join(outDir, it.name);
      let k = 1;
      while (fs.existsSync(target)) { const e = path.extname(it.name); target = path.join(outDir, `${path.basename(it.name, e)} (${k++})${e}`); }
      try {
        if (it.resident) {
          await fsp.writeFile(target, Buffer.from(it.resident, 'base64'));
        } else if (it.runs) {
          const fh = await fsp.open(target, 'w');
          try {
            let written = 0;
            for (const r of it.runs) {
              if (written >= it.size) break;
              let remaining = Math.min(r.len * vol.clusterSize, it.size - written);
              let clOff = 0;
              while (remaining > 0) {
                const len = Math.min(remaining, 8 * 1024 * 1024);
                const buf = r.lcn == null ? Buffer.alloc(len) : await vol.readRawAsync(r.lcn * vol.clusterSize + clOff, Math.ceil(len / vol.bytesPerSector) * vol.bytesPerSector);
                await fh.write(buf, 0, len);
                written += len; remaining -= len; clOff += len;
              }
            }
            await fh.truncate(it.size);
          } finally { await fh.close(); }
          if (it.mtime) { try { await fsp.utimes(target, new Date(), new Date(it.mtime)); } catch (e) {} }
        } else throw new Error('Dati non disponibili');
        ok++;
      } catch (e) { failed.push({ name: it.name, error: String(e.message || e) }); }
    }
  } finally { vol.close(); }
  store.addStat('filesRecovered', ok, { type: 'recovery', items: ok });
  return { recovered: ok, failed, destination: dest };
}

async function recycleBin() {
  const r = await ps.json(`
$sh = New-Object -ComObject Shell.Application
$rb = $sh.Namespace(10)
$i = 0
$o = @(foreach ($it in $rb.Items()) { $from = ''; try { $from = $it.ExtendedProperty('System.Recycle.DeletedFrom') } catch {}
  $dd = $null; try { $dd = ([datetime]$it.ExtendedProperty('System.Recycle.DateDeleted')).ToString('o') } catch {}
  @{ idx = $i; name = $it.Name; from = $from; size = [int64]$it.Size; deleted = $dd; path = $it.Path }; $i++ })
Emit-Result $o`);
  return ps.arr(r);
}

async function restoreFromRecycleBin(opts) {
  return ps.json(`
$sh = New-Object -ComObject Shell.Application
$rb = $sh.Namespace(10)
$n = 0
$items = @($rb.Items())
foreach ($p in $A) { $it = $items | Where-Object { $_.Path -eq $p } | Select-Object -First 1; if ($it) { $it.InvokeVerb('undelete'); $n++ } }
Emit-Result @{ restored = $n }`, { args: opts.paths });
}

function cancel() { cancelFlag = true; return { ok: true }; }

module.exports = { drives, scan, recover, cancel, recycleBin, restoreFromRecycleBin };
