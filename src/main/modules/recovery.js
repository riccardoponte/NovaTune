// File Recovery: quick scan (NTFS MFT / FAT / exFAT), deep scan (file signatures), preview,
// saved scans, disk images, thumbnail cache, Recycle Bin and BitLocker unlock.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const ps = require('../ps');
const store = require('../store');
const { Volume, detectPartitions, detectFs } = require('../recovery/volume');
const ntfs = require('../recovery/ntfs');
const fat = require('../recovery/fat');
const carve = require('../recovery/carve');
const thumbs = require('../recovery/thumbcache');
const zipLib = require('../recovery/ziplib');

let cancelFlag = false;
let lastScan = null; // { source, fs, items, date }

function sourceOf(opts) {
  if (opts.image) return { image: opts.image, partitionOffset: opts.partitionOffset || 0 };
  return { letter: String(opts.letter).toUpperCase() };
}
function sourceLabel(src) { return src.image ? path.basename(src.image) : src.letter + ':'; }

// ------------------------------------------------------------------ drives
async function drives() {
  const r = await ps.json(`
$bl = @{}
try { Get-CimInstance -Namespace 'root/cimv2/Security/MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume -ErrorAction Stop | ForEach-Object {
  $ls = Invoke-CimMethod -InputObject $_ -MethodName GetLockStatus
  if ($_.DriveLetter) { $bl[$_.DriveLetter.Substring(0,1)] = @{ protection = [int]$_.ProtectionStatus; locked = ([int]$ls.LockStatus -eq 1) } } } } catch {}
$o = @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } | ForEach-Object {
  $l = $_.DeviceID.Substring(0,1); $b = $bl[$l]
  if (-not $_.Size -and -not ($b -and $b.locked)) { return }
  @{ letter = $l; fs = [string]$_.FileSystem; label = [string]$_.VolumeName; size = [int64]$_.Size; free = [int64]$_.FreeSpace; removable = ($_.DriveType -eq 2); bitlocker = $(if ($b) { $b.protection -eq 1 -or $b.locked } else { $false }); locked = $(if ($b) { $b.locked } else { $false }) } })
Emit-Result $o`, { timeout: 60000 });
  return ps.arr(r);
}

// ------------------------------------------------------------------ scan
function recycleNames(items) {
  // $Recycle.Bin: $I files (resident, small) contain the original path of the matching $R file
  const map = new Map();
  for (const it of items) {
    if (!/^\$I[A-Z0-9]{6}/i.test(it.name) || !it.resident) continue;
    try {
      const b = Buffer.from(it.resident, 'base64');
      const ver = Number(b.readBigUInt64LE(0));
      const del = Number(b.readBigUInt64LE(16) / 10000n) - 11644473600000;
      let orig = '';
      if (ver === 2) orig = b.toString('utf16le', 28, 28 + (b.readUInt32LE(24) - 1) * 2);
      else orig = b.toString('utf16le', 24, 24 + 520).replace(/\0.*$/, '');
      map.set(it.name.slice(2).toLowerCase(), { orig, del });
    } catch (e) {}
  }
  const out = [];
  const inBin = (f) => /\\\$recycle\.bin(\\|$)/i.test(f);
  for (const it of items) {
    if (/^\$I[A-Z0-9]{6}/i.test(it.name) && inBin(it.folder)) continue; // index files: not user data
    if (inBin(it.folder)) {
      // file deleted to the Recycle Bin and then emptied: "$Rxxxxxx.ext"
      const m = /^\$R[A-Z0-9]{6}/i.test(it.name) ? map.get(it.name.slice(2).toLowerCase()) : null;
      if (m && m.orig) {
        it.name = path.win32.basename(m.orig);
        it.folder = 'Cestino svuotato → ' + path.win32.dirname(m.orig);
        it.deleted = m.del;
      } else {
        // file inside a deleted folder: "...\$RECYCLE.BIN\<SID>\$Rxxxxxx\sub\file"
        const seg = it.folder.match(/\\\$recycle\.bin\\[^\\]+\\\$R([A-Z0-9]{6})(\\.*)?$/i);
        const mf = seg ? map.get(seg[1].toLowerCase()) : null;
        if (mf && mf.orig) { it.folder = 'Cestino svuotato → ' + mf.orig + (seg[2] || ''); it.deleted = mf.del; }
      }
    }
    out.push(it);
  }
  return out;
}

async function scan(opts, ctx = {}) {
  cancelFlag = false;
  const src = sourceOf(opts);
  const vol = await Volume.open(src);
  const c = { progress: (p) => ctx.progress && ctx.progress(p), cancelled: () => cancelFlag };
  try {
    const fsType = detectFs(vol);
    if (!vol.size && src.letter) {
      const d = (await drives()).find((x) => x.letter === src.letter);
      if (d) vol.size = d.size;
    }
    let base = { items: [] };
    if (fsType === 'NTFS') base = await ntfs.scan(vol, c);
    else if (fsType === 'exFAT') base = await fat.scanExfat(vol, c);
    else if (fsType === 'FAT32' || fsType === 'FAT16') base = await fat.scanFat(vol, c);
    let items = recycleNames(base.items);
    if (opts.mode === 'deep' && !cancelFlag) {
      const known = new Set(items.filter((i) => i.extents.length && i.chance !== 'poor').map((i) => i.extents[0].off));
      const region = base.clusterSize ? { dataOffset: base.dataOffset, clusterSize: base.clusterSize, totalClusters: base.totalClusters, isFree: base.isFree } : null;
      if (!vol.size) throw new Error('Dimensione del volume sconosciuta');
      const carved = await carve.scan(vol, region, { progress: (p) => c.progress(Object.assign({}, p, { label: p.label })), cancelled: c.cancelled }, { knownOffsets: known });
      items = items.concat(carved);
    }
    const folders = (opts.folders || (opts.folder ? [opts.folder] : [])).map((f) => f.toLowerCase().replace(/\\+$/, ''));
    if (folders.length) items = items.filter((i) => { const f = i.folder.toLowerCase(); return folders.some((x) => f === x || f.startsWith(x + '\\') || (x.includes('cestino svuotato') && f.startsWith(x))); });
    items.forEach((it, i) => { it.i = i; });
    lastScan = { source: src, fs: fsType, items, date: new Date().toISOString(), mode: opts.mode || 'quick', scope: opts.scope || null };
    return summary();
  } finally { vol.close(); }
}

function summary() {
  if (!lastScan) return null;
  return {
    source: lastScan.source, label: sourceLabel(lastScan.source), fs: lastScan.fs, date: lastScan.date, mode: lastScan.mode, scope: lastScan.scope, cancelled: cancelFlag,
    count: lastScan.items.length,
    items: lastScan.items.map((d) => ({ i: d.i, name: d.name, folder: d.folder, size: d.size, mtime: d.mtime || d.deleted || 0, type: d.type, chance: d.chance, source: d.source }))
  };
}

// ------------------------------------------------------------------ read data of an item
async function readItem(vol, it, maxBytes, onChunk) {
  const limit = Math.min(it.size, maxBytes == null ? it.size : maxBytes);
  if (it.resident) {
    const b = Buffer.from(it.resident, 'base64').subarray(0, limit);
    if (onChunk) { await onChunk(b); return null; }
    return b;
  }
  const parts = [];
  let done = 0;
  for (const ex of it.extents) {
    if (done >= limit) break;
    let remaining = Math.min(ex.len, limit - done);
    let o = 0;
    while (remaining > 0) {
      const n = Math.min(remaining, 8 * 1024 * 1024);
      const b = ex.off == null ? Buffer.alloc(n) : Buffer.from(await vol.readAsync(ex.off + o, n, true));
      if (onChunk) await onChunk(b); else parts.push(b);
      done += n; remaining -= n; o += n;
    }
  }
  return onChunk ? null : Buffer.concat(parts);
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/plain', log: 'text/plain', md: 'text/plain', json: 'text/plain', xml: 'text/plain', html: 'text/plain', htm: 'text/plain', ini: 'text/plain', js: 'text/plain', css: 'text/plain', rtf: 'text/plain' };

async function preview(opts) {
  if (!lastScan) throw new Error('Nessuna scansione disponibile');
  const it = lastScan.items[opts.i];
  if (!it) throw new Error('Elemento non trovato');
  const ext = (path.extname(it.name).slice(1) || '').toLowerCase();
  const mime = MIME[ext];
  const isMedia = /^(video|audio)/.test(mime || '');
  const max = mime === 'text/plain' ? 256 * 1024 : isMedia ? 300 * 1024 * 1024 : 60 * 1024 * 1024;
  const vol = await Volume.open(lastScan.source);
  try {
    if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'epub', 'jar', 'apk'].includes(ext)) {
      if (it.size > 200 * 1024 * 1024) return { kind: 'none', reason: 'File troppo grande per l\'anteprima' };
      const data = await readItem(vol, it);
      return Object.assign({ name: it.name, size: it.size }, zipLib.previewOffice(data, ext));
    }
    if (!mime) {
      const head = await readItem(vol, it, 512);
      return { kind: 'hex', name: it.name, size: it.size, hex: head.toString('hex') };
    }
    const data = await readItem(vol, it, max);
    if (mime === 'text/plain') return { kind: 'text', name: it.name, size: it.size, text: data.toString('utf8'), truncated: it.size > max };
    return { kind: mime.split('/')[0] === 'application' ? 'pdf' : mime.split('/')[0], mime, name: it.name, size: it.size, data, truncated: it.size > max };
  } finally { vol.close(); }
}

// ------------------------------------------------------------------ recover
async function destInfo(dest) {
  const letter = path.parse(dest).root.slice(0, 1).toUpperCase();
  const r = await ps.json(`$d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $A.l + ":'"); Emit-Result @{ fs = [string]$d.FileSystem; free = [int64]$d.FreeSpace }`, { args: { l: letter } }).catch(() => ({}));
  return Object.assign({ letter }, r);
}

const TYPE_FOLDER = { image: 'Immagini', document: 'Documenti', video: 'Video', music: 'Audio', archive: 'Archivi', other: 'Altri file' };

async function recover(opts, ctx = {}) {
  if (!lastScan) throw new Error('Esegui prima una scansione.');
  cancelFlag = false;
  const dest = opts.destination;
  if (!dest) throw new Error('Seleziona una cartella di destinazione.');
  const list = opts.indexes.map((i) => lastScan.items[i]).filter(Boolean);
  const total = list.reduce((a, it) => a + it.size, 0);
  const di = await destInfo(dest);
  if (!opts.force) {
    if (lastScan.source.letter && di.letter === lastScan.source.letter) return { needConfirm: 'same' };
    if (di.free && total > di.free) return { needConfirm: 'space', need: total, free: di.free };
    if (/FAT/i.test(di.fs || '') && di.fs !== 'exFAT' && list.some((it) => it.size >= 4294967296)) return { needConfirm: 'fat32' };
  }
  const vol = await Volume.open(lastScan.source);
  let ok = 0, bytes = 0, renamed = 0;
  const failed = [];
  try {
    let n = 0;
    for (const it of list) {
      if (cancelFlag) break;
      n++;
      let rel = '';
      if (opts.mode === 'path') rel = it.folder.replace(/^[A-Z]:\\?/i, '').replace(/→/g, '-').replace(/[<>:"|?*]/g, '_');
      else if (opts.mode === 'type') rel = TYPE_FOLDER[it.type] || 'Altri file';
      const outDir = path.join(dest, rel);
      await fsp.mkdir(outDir, { recursive: true });
      let name = it.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      if (name.length > 180) { name = name.slice(0, 170) + path.extname(name).slice(0, 10); renamed++; }
      let target = path.join(outDir, name);
      let k = 1;
      while (fs.existsSync(target)) { const e = path.extname(name); target = path.join(outDir, `${path.basename(name, e)} (${k++})${e}`); }
      if (ctx.progress) ctx.progress({ percent: total ? Math.round((bytes / total) * 100) : Math.round((n / list.length) * 100), label: `Recupero ${n} di ${list.length}: ${it.name}` });
      try {
        const fh = await fsp.open(target, 'w');
        try {
          let written = 0;
          await readItem(vol, it, null, async (b) => {
            const take = Math.min(b.length, it.size - written);
            if (take > 0) await fh.write(b, 0, take);
            written += take; bytes += take;
            if (ctx.progress && total) ctx.progress({ percent: Math.min(99, Math.round((bytes / total) * 100)), label: `Recupero ${n} di ${list.length}: ${it.name}` });
          });
        } finally { await fh.close(); }
        if (it.mtime) { try { await fsp.utimes(target, new Date(), new Date(it.mtime)); } catch (e) {} }
        ok++;
      } catch (e) { failed.push({ name: it.name, error: String(e.message || e) }); }
    }
  } finally { vol.close(); }
  store.addStat('filesRecovered', ok, { type: 'recovery', items: ok, bytes });
  return { recovered: ok, failed, destination: dest, bytes, renamed, cancelled: cancelFlag };
}

// ------------------------------------------------------------------ saved scans
function scansDir() { const d = store.dir('recovery-scans'); fs.mkdirSync(d, { recursive: true }); return d; }

async function saveScan() {
  if (!lastScan) throw new Error('Nessuna scansione da salvare');
  const name = `${sourceLabel(lastScan.source).replace(/[:\\/]/g, '')}_${lastScan.date.replace(/[:.]/g, '-')}.json`;
  const f = path.join(scansDir(), name);
  await fsp.writeFile(f, JSON.stringify(lastScan));
  return { file: f };
}

function listScans() {
  const d = scansDir();
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => {
    const st = fs.statSync(path.join(d, f));
    let meta = {};
    try { const fd = fs.openSync(path.join(d, f), 'r'); const b = Buffer.alloc(400); fs.readSync(fd, b, 0, 400, 0); fs.closeSync(fd); const s = b.toString('utf8'); meta = { label: (s.match(/"letter":"(\w)"/) || [])[1] ? (s.match(/"letter":"(\w)"/)[1] + ':') : (s.match(/"image":"([^"]+)"/) || [, 'immagine'])[1].split(/\\\\/).pop(), mode: (s.match(/"mode":"(\w+)"/) || [])[1] }; } catch (e) {}
    return { file: f, size: st.size, date: st.mtime.toISOString(), label: meta.label || f, mode: meta.mode };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

async function loadScan(opts) {
  const f = path.join(scansDir(), path.basename(opts.file));
  lastScan = JSON.parse(await fsp.readFile(f, 'utf8'));
  lastScan.items.forEach((it, i) => { it.i = i; });
  if (!lastScan.mode) lastScan.mode = 'quick';
  return summary();
}

function deleteScan(opts) { fs.unlinkSync(path.join(scansDir(), path.basename(opts.file))); return { ok: true }; }

// ------------------------------------------------------------------ disk image
async function createImage(opts, ctx = {}) {
  cancelFlag = false;
  const src = { letter: String(opts.letter).toUpperCase() };
  const d = (await drives()).find((x) => x.letter === src.letter);
  if (!d) throw new Error('Unità non trovata');
  const target = opts.destination;
  if (path.parse(target).root.slice(0, 1).toUpperCase() === src.letter) throw new Error('Salva l\'immagine su un\'unità diversa da quella di origine.');
  const vol = await Volume.open(src);
  const fsType = detectFs(vol);
  let size = d.size;
  try { if (fsType === 'NTFS') { ntfs.info(vol); size = vol.size; } else if (fsType === 'exFAT') { fat.exfatInfo(vol); size = vol.size; } else if (/FAT/.test(fsType)) { fat.fatInfo(vol); size = vol.size; } } catch (e) {}
  const di = await destInfo(target);
  if (di.free && di.free < size) { vol.close(); throw new Error(`Spazio insufficiente sull'unità di destinazione: servono ${Math.ceil(size / 1073741824)} GB.`); }
  if (/^FAT/.test(di.fs || '') && di.fs !== 'exFAT' && size >= 4294967296) { vol.close(); throw new Error('L\'unità di destinazione è FAT32 e non può contenere file oltre 4 GB.'); }
  const fh = await fsp.open(target, 'w');
  const BLK = 8 * 1024 * 1024;
  let pos = 0, bad = 0;
  const t0 = Date.now();
  try {
    while (pos < size && !cancelFlag) {
      const n = Math.min(BLK, size - pos);
      let b;
      try { b = Buffer.from(await vol.readAsync(pos, n)); }
      catch (e) {
        // unreadable area: read sector by sector, zero-filling bad sectors
        b = Buffer.alloc(n);
        for (let s = 0; s < n; s += 512) {
          try { vol.read(pos + s, 512).copy(b, s); } catch (er) { bad++; }
        }
      }
      await fh.write(b, 0, n, pos);
      pos += n;
      const el = (Date.now() - t0) / 1000;
      const speed = el > 0 ? pos / el : 0;
      if (ctx.progress) ctx.progress({ percent: Math.round((pos / size) * 100), label: `Creazione immagine: ${Math.round(pos / 1048576)} MB di ${Math.round(size / 1048576)} MB`, speed, eta: speed ? (size - pos) / speed : 0, bad });
    }
  } finally { await fh.close(); vol.close(); }
  return { ok: !cancelFlag, file: target, size: pos, bad, cancelled: cancelFlag };
}

function imagePartitions(opts) { return detectPartitions(opts.image); }

// ------------------------------------------------------------------ thumbnail cache
async function thumbcache(opts, ctx) { return thumbs.list(ctx); }
async function exportThumbs(opts) { return thumbs.exportAll(opts.ids, opts.destination); }

// ------------------------------------------------------------------ BitLocker
async function unlockBitlocker(opts) {
  const r = await ps.json(`
$v = Get-CimInstance -Namespace 'root/cimv2/Security/MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume -Filter ("DriveLetter='" + $A.l + ":'")
if (-not $v) { Emit-Result @{ ok = $false; error = 'Volume BitLocker non trovato' }; return }
if ($A.key) { $res = Invoke-CimMethod -InputObject $v -MethodName UnlockWithNumericalPassword -Arguments @{ NumericalPassword = $A.key } }
else { $res = Invoke-CimMethod -InputObject $v -MethodName UnlockWithPassphrase -Arguments @{ Passphrase = $A.pw } }
Emit-Result @{ ok = ($res.ReturnValue -eq 0); code = [int64]$res.ReturnValue }`, { args: { l: String(opts.letter).toUpperCase(), pw: opts.password || '', key: opts.recoveryKey || '' } });
  if (!r.ok) r.error = r.error || (r.code === 2150694965 || r.code === 2150694940 ? 'Password o chiave di ripristino non corretta' : `Sblocco non riuscito (codice 0x${(r.code >>> 0).toString(16)})`);
  return r;
}

// ------------------------------------------------------------------ Recycle Bin (still present)
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

function specialFolders() {
  const home = os.homedir();
  const desk = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'OneDrive', 'Desktop')].find((p) => fs.existsSync(p)) || path.join(home, 'Desktop');
  return { desktop: desk, documents: path.join(home, 'Documents'), pictures: path.join(home, 'Pictures'), downloads: path.join(home, 'Downloads') };
}

function cancel() { cancelFlag = true; return { ok: true }; }
function current() { return summary(); }

module.exports = { _recycleNames: recycleNames, drives, scan, current, preview, recover, cancel, saveScan, listScans, loadScan, deleteScan, createImage, imagePartitions, thumbcache, exportThumbs, unlockBitlocker, recycleBin, restoreFromRecycleBin, specialFolders };
