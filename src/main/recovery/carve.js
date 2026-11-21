// Deep scan ("file carving"): finds files by their internal signature, without any file-system metadata.
// Works on formatted drives, damaged file systems, RAW partitions, and the free space of NTFS/FAT/exFAT.
const { typeOf, yieldLoop } = require('./common');

const MB = 1024 * 1024;
const CHUNK = 16 * MB;

/** Reader bound to a file candidate: read(rel, len) -> Buffer (may be shorter at end of volume) */
function makeReader(vol, start, limit) {
  const cache = { off: -1, buf: null };
  return async (rel, len) => {
    if (rel >= limit) return Buffer.alloc(0);
    len = Math.min(len, limit - rel);
    if (cache.buf && rel >= cache.off && rel + len <= cache.off + cache.buf.length) return cache.buf.subarray(rel - cache.off, rel - cache.off + len);
    const blk = Math.max(len, 256 * 1024);
    const want = Math.min(blk, limit - rel);
    cache.buf = Buffer.from(await vol.readAsync(start + rel, want, true));
    cache.off = rel;
    return cache.buf.subarray(0, len);
  };
}

/** Search `pattern` from `rel` up to `max` bytes; returns relative position or -1 */
async function find(read, pattern, rel, max, stepSize = MB) {
  const p = Buffer.from(pattern);
  let pos = rel;
  while (pos < max) {
    const b = await read(pos, Math.min(stepSize + p.length, max - pos));
    if (!b.length) return -1;
    const i = b.indexOf(p);
    if (i >= 0) return pos + i;
    if (b.length < p.length) return -1;
    pos += b.length - p.length + 1;
  }
  return -1;
}

// ------------------------------------------------------------- format parsers
// each returns { size, ext } or null

async function jpeg(read) {
  let pos = 2;
  for (let guard = 0; guard < 500; guard++) {
    const h = await read(pos, 4);
    if (h.length < 4 || h[0] !== 0xFF) return null;
    const m = h[1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { pos += 2; continue; }
    const len = h.readUInt16BE(2);
    if (len < 2) return null;
    if (m === 0xDA) {
      // entropy-coded data: look for FFD9 not inside stuffing
      let p = pos + 2 + len;
      const max = 64 * MB;
      for (;;) {
        const e = await find(read, [0xFF, 0xD9], p, max);
        if (e < 0) return null;
        return { size: e + 2, ext: 'jpg' };
      }
    }
    pos += 2 + len;
    if (pos > 16 * MB) return null;
  }
  return null;
}

async function png(read) {
  let pos = 8;
  for (let guard = 0; guard < 100000; guard++) {
    const h = await read(pos, 8);
    if (h.length < 8) return null;
    const len = h.readUInt32BE(0), type = h.toString('latin1', 4, 8);
    if (!/^[A-Za-z]{4}$/.test(type) || len > 256 * MB) return null;
    pos += 12 + len;
    if (type === 'IEND') return { size: pos, ext: 'png' };
    if (pos > 512 * MB) return null;
  }
  return null;
}

async function gif(read) {
  const h = await read(0, 13);
  if (h.length < 13) return null;
  let pos = 13;
  if (h[10] & 0x80) pos += 3 * (1 << ((h[10] & 7) + 1));
  const subBlocks = async (p) => { for (let g = 0; g < 1e7; g++) { const b = await read(p, 1); if (!b.length) return -1; if (b[0] === 0) return p + 1; p += 1 + b[0]; } return -1; };
  for (let guard = 0; guard < 1e6; guard++) {
    const b = await read(pos, 1);
    if (!b.length) return null;
    if (b[0] === 0x3B) return { size: pos + 1, ext: 'gif' };
    if (b[0] === 0x21) { pos = await subBlocks(pos + 2); if (pos < 0) return null; continue; }
    if (b[0] === 0x2C) {
      const d = await read(pos, 10);
      pos += 10;
      if (d[9] & 0x80) pos += 3 * (1 << ((d[9] & 7) + 1));
      pos = await subBlocks(pos + 1);
      if (pos < 0) return null;
      continue;
    }
    return null;
  }
  return null;
}

async function bmp(read) {
  const h = await read(0, 30);
  if (h.length < 30) return null;
  const size = h.readUInt32LE(2), dataOff = h.readUInt32LE(10), hdr = h.readUInt32LE(14);
  if (h.readUInt32LE(6) !== 0 || ![12, 40, 52, 56, 108, 124].includes(hdr) || dataOff >= size || size < 64 || size > 200 * MB) return null;
  return { size, ext: 'bmp' };
}

async function pdf(read) {
  const max = 512 * MB;
  let pos = 5, last = -1;
  for (let g = 0; g < 1000; g++) {
    const e = await find(read, '%%EOF', pos, max);
    if (e < 0) break;
    last = e;
    // incremental update? continue only if more PDF syntax follows soon
    const tail = (await read(e + 5, 2048)).toString('latin1');
    if (!/\d+ \d+ obj|xref|trailer|startxref/.test(tail)) break;
    pos = e + 5;
  }
  if (last < 0) return null;
  let size = last + 5;
  const t = await read(size, 2);
  if (t[0] === 0x0D) size += t[1] === 0x0A ? 2 : 1; else if (t[0] === 0x0A) size += 1;
  return { size, ext: 'pdf' };
}

async function zip(read) {
  const head = await read(0, 64 * 1024);
  const names = [];
  let p = 0;
  while (p + 30 < head.length && head.readUInt32LE(p) === 0x04034b50 && names.length < 40) {
    const nl = head.readUInt16LE(p + 26), xl = head.readUInt16LE(p + 28), cs = head.readUInt32LE(p + 18);
    const name = head.toString('utf8', p + 30, p + 30 + nl);
    names.push(name);
    if (names.length === 1 && name === 'mimetype') names.push('mime:' + head.toString('latin1', p + 30 + nl + xl, p + 30 + nl + xl + Math.min(cs, 80)));
    if (!cs || head.readUInt16LE(p + 6) & 0x08) break;
    p += 30 + nl + xl + cs;
  }
  const e = await find(read, [0x50, 0x4B, 0x05, 0x06], 0, 2048 * MB, 4 * MB);
  if (e < 0) return null;
  const t = await read(e, 22);
  if (t.length < 22) return null;
  const size = e + 22 + t.readUInt16LE(20);
  const all = names.join('|');
  let ext = 'zip';
  if (/mime:application\/vnd\.oasis\.opendocument\.text/.test(all)) ext = 'odt';
  else if (/mime:application\/vnd\.oasis\.opendocument\.spreadsheet/.test(all)) ext = 'ods';
  else if (/mime:application\/vnd\.oasis\.opendocument\.presentation/.test(all)) ext = 'odp';
  else if (/mime:application\/epub\+zip/.test(all)) ext = 'epub';
  else if (/(^|\|)word\//.test(all)) ext = 'docx';
  else if (/(^|\|)xl\//.test(all)) ext = 'xlsx';
  else if (/(^|\|)ppt\//.test(all)) ext = 'pptx';
  else if (/\[Content_Types\]\.xml/.test(all)) ext = 'docx';
  else if (/AndroidManifest\.xml/.test(all)) ext = 'apk';
  else if (/META-INF\/MANIFEST\.MF/.test(all)) ext = 'jar';
  return { size, ext };
}

function vint(b, p) { let v = 0, s = 0, i = 0; for (; i < 10; i++) { const x = b[p + i]; if (x === undefined) return null; v += (x & 0x7F) * Math.pow(2, s); s += 7; if (!(x & 0x80)) return { v, n: i + 1 }; } return null; }

async function rar(read) {
  const sig = await read(0, 8);
  if (sig[6] === 0x01 && sig[7] === 0x00) { // RAR5
    let pos = 8;
    for (let g = 0; g < 1e6; g++) {
      const b = await read(pos, 32);
      if (b.length < 7) return null;
      const hs = vint(b, 4); if (!hs) return null;
      const hdrStart = 4 + hs.n;
      const hb = await read(pos + hdrStart, hs.v);
      const type = vint(hb, 0); if (!type) return null;
      const flags = vint(hb, type.n); if (!flags) return null;
      let q = type.n + flags.n, dataSize = 0;
      if (flags.v & 1) { const ex = vint(hb, q); if (!ex) return null; q += ex.n; }
      if (flags.v & 2) { const ds = vint(hb, q); if (!ds) return null; dataSize = ds.v; }
      pos += hdrStart + hs.v + dataSize;
      if (type.v === 5) return { size: pos, ext: 'rar' };
      if (pos > 8192 * MB) return null;
    }
    return null;
  }
  let pos = 7; // RAR4
  for (let g = 0; g < 1e6; g++) {
    const b = await read(pos, 11);
    if (b.length < 7) return null;
    const type = b[2], flags = b.readUInt16LE(3), hsize = b.readUInt16LE(5);
    if (hsize < 7 || type < 0x72 || type > 0x7B) return null;
    let add = 0;
    if ((flags & 0x8000) && b.length >= 11) add = b.readUInt32LE(7);
    pos += hsize + add;
    if (type === 0x7B) return { size: pos, ext: 'rar' };
    if (pos > 8192 * MB) return null;
  }
  return null;
}

async function sevenz(read) {
  const h = await read(0, 32);
  if (h.length < 32) return null;
  const off = Number(h.readBigUInt64LE(12)), sz = Number(h.readBigUInt64LE(20));
  const size = 32 + off + sz;
  if (!sz || size > 8192 * MB) return null;
  return { size, ext: '7z' };
}

const BOX = /^(ftyp|moov|mdat|free|skip|wide|uuid|meta|pdin|moof|mfra|styp|sidx|udta|pnot|junk|prfl|mvhd|iinf|idat|iloc|pitm|iprp|iref|dinf|hdlr|ssix|prft|emsg|PICT|beam|XMP_|thmb|CNCV|CNTH)$/;
async function isoBmff(read) {
  const f = await read(0, 32);
  const brand = f.toString('latin1', 8, 12);
  let pos = 0, sawMedia = false;
  for (let g = 0; g < 100000; g++) {
    const b = await read(pos, 16);
    if (b.length < 8) break;
    let size = b.readUInt32BE(0);
    const type = b.toString('latin1', 4, 8);
    if (!BOX.test(type)) break;
    if (size === 1) size = Number(b.readBigUInt64BE(8));
    else if (size === 0) return null; // "until end of file": unknown
    if (size < 8) return null;
    if (type === 'moov' || type === 'mdat' || type === 'meta' || type === 'moof') sawMedia = true;
    pos += size;
    if (pos > 16384 * MB) return null;
  }
  if (!sawMedia || pos < 64) return null;
  let ext = 'mp4';
  if (/^qt/.test(brand)) ext = 'mov';
  else if (/^(heic|heix|hevc|mif1|msf1|heim|heis)/.test(brand)) ext = 'heic';
  else if (/^avi[fs]/.test(brand)) ext = 'avif';
  else if (/^M4A/.test(brand)) ext = 'm4a';
  else if (/^M4V/.test(brand)) ext = 'm4v';
  else if (/^3g/.test(brand)) ext = '3gp';
  else if (/^crx/.test(brand)) ext = 'cr3';
  return { size: pos, ext };
}

async function riff(read) {
  const h = await read(0, 12);
  const size = h.readUInt32LE(4) + 8, form = h.toString('latin1', 8, 12);
  const ext = { 'AVI ': 'avi', WAVE: 'wav', WEBP: 'webp', 'AVIX': 'avi' }[form];
  if (!ext || size < 44 || size > 8192 * MB) return null;
  return { size: size + (size & 1), ext };
}

function ebmlVint(b, p, isId) {
  const x = b[p];
  if (!x) return null;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(x & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = isId ? x : x & (mask - 1);
  let unknown = !isId && v === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xFF) unknown = false; }
  return { v, n: len, unknown };
}

async function mkv(read) {
  const b = await read(0, 64);
  const id = ebmlVint(b, 0, true), sz = ebmlVint(b, id.n);
  if (!sz) return null;
  let pos = id.n + sz.n + sz.v;
  const s = await read(pos, 16);
  const sid = ebmlVint(s, 0, true);
  if (!sid || sid.v !== 0x18538067) return null;
  const ssz = ebmlVint(s, sid.n);
  if (!ssz || ssz.unknown) return null;
  const size = pos + sid.n + ssz.n + ssz.v;
  const doc = b.toString('latin1').includes('webm') ? 'webm' : 'mkv';
  return { size, ext: doc };
}

const MP3_BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
async function mp3(read) {
  const h = await read(0, 10);
  let pos = 10 + ((h[6] & 0x7F) << 21 | (h[7] & 0x7F) << 14 | (h[8] & 0x7F) << 7 | (h[9] & 0x7F));
  if (h[5] & 0x10) pos += 10;
  let frames = 0;
  for (let g = 0; g < 2e6; g++) {
    const f = await read(pos, 4);
    if (f.length < 4 || f[0] !== 0xFF || (f[1] & 0xE0) !== 0xE0) break;
    const ver = (f[1] >> 3) & 3, layer = (f[1] >> 1) & 3, bi = f[2] >> 4, ri = (f[2] >> 2) & 3, pad = (f[2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) break;
    const br = (ver === 3 ? MP3_BITRATES[1] : MP3_BITRATES[2])[bi] * 1000, sr = MP3_RATES[ver][ri];
    const len = Math.floor(((ver === 3 ? 144 : 72) * br) / sr) + pad;
    if (len < 24) break;
    pos += len; frames++;
  }
  if (frames < 10) return null;
  const tag = await read(pos, 3);
  if (tag.toString('latin1') === 'TAG') pos += 128;
  return { size: pos, ext: 'mp3' };
}

async function ole(read) {
  const h = await read(0, 512);
  const ss = 1 << h.readUInt16LE(0x1E);
  if (ss !== 512 && ss !== 4096) return null;
  const nFat = h.readUInt32LE(0x2C), dirStart = h.readUInt32LE(0x30);
  let maxSec = dirStart;
  const fatSecs = [];
  for (let i = 0; i < Math.min(nFat, 109); i++) fatSecs.push(h.readUInt32LE(0x4C + i * 4));
  for (const fs of fatSecs) {
    if (fs >= 0xFFFFFFFA) continue;
    maxSec = Math.max(maxSec, fs);
    const b = await read((fs + 1) * ss, ss);
    for (let i = 0; i + 4 <= b.length; i += 4) {
      const v = b.readUInt32LE(i);
      if (v !== 0xFFFFFFFF) maxSec = Math.max(maxSec, (fatSecs.indexOf(fs) * ss) / 4 + i / 4);
    }
  }
  const size = (maxSec + 2) * ss;
  if (size > 2048 * MB) return null;
  const dir = (await read((dirStart + 1) * ss, ss)).toString('utf16le');
  let ext = 'ole';
  if (dir.includes('WordDocument')) ext = 'doc';
  else if (dir.includes('Workbook') || dir.includes('Book')) ext = 'xls';
  else if (dir.includes('PowerPoint Document')) ext = 'ppt';
  else if (dir.includes('__substg1.0_')) ext = 'msg';
  else if (dir.includes('Thumbs')) ext = 'db';
  return { size, ext };
}

/** Quick signature test at buf[i]; returns parser or null */
function detect(b, i) {
  const c = b[i];
  switch (c) {
    case 0xFF: return b[i + 1] === 0xD8 && b[i + 2] === 0xFF && (b[i + 3] >= 0xC0) ? jpeg : null;
    case 0x89: return b[i + 1] === 0x50 && b[i + 2] === 0x4E && b[i + 3] === 0x47 && b[i + 4] === 0x0D ? png : null;
    case 0x47: return b[i + 1] === 0x49 && b[i + 2] === 0x46 && b[i + 3] === 0x38 && (b[i + 4] === 0x37 || b[i + 4] === 0x39) && b[i + 5] === 0x61 ? gif : null;
    case 0x42: return b[i + 1] === 0x4D && b[i + 6] === 0 && b[i + 7] === 0 && b[i + 8] === 0 && b[i + 9] === 0 ? bmp : null;
    case 0x25: return b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2D ? pdf : null;
    case 0x50: return b[i + 1] === 0x4B && b[i + 2] === 0x03 && b[i + 3] === 0x04 ? zip : null;
    case 0x52:
      if (b[i + 1] === 0x61 && b[i + 2] === 0x72 && b[i + 3] === 0x21 && b[i + 4] === 0x1A && b[i + 5] === 0x07) return rar;
      if (b[i + 1] === 0x49 && b[i + 2] === 0x46 && b[i + 3] === 0x46) return riff;
      return null;
    case 0x37: return b[i + 1] === 0x7A && b[i + 2] === 0xBC && b[i + 3] === 0xAF && b[i + 4] === 0x27 && b[i + 5] === 0x1C ? sevenz : null;
    case 0x1A: return b[i + 1] === 0x45 && b[i + 2] === 0xDF && b[i + 3] === 0xA3 ? mkv : null;
    case 0x49: return b[i + 1] === 0x44 && b[i + 2] === 0x33 && b[i + 3] < 5 ? mp3 : null;
    case 0xD0: return b[i + 1] === 0xCF && b[i + 2] === 0x11 && b[i + 3] === 0xE0 && b[i + 4] === 0xA1 && b[i + 5] === 0xB1 ? ole : null;
  }
  if (b[i + 4] === 0x66 && b[i + 5] === 0x74 && b[i + 6] === 0x79 && b[i + 7] === 0x70 && b.readUInt32BE(i) >= 8 && b.readUInt32BE(i) < 512) return isoBmff;
  return null;
}

const GROUP = { jpg: 'Immagini JPEG', png: 'Immagini PNG', gif: 'Immagini GIF', bmp: 'Immagini BMP', heic: 'Foto HEIC', avif: 'Immagini AVIF', webp: 'Immagini WebP', cr3: 'Foto RAW Canon', pdf: 'Documenti PDF', docx: 'Documenti Word', xlsx: 'Fogli Excel', pptx: 'Presentazioni PowerPoint', doc: 'Documenti Word (97-2003)', xls: 'Fogli Excel (97-2003)', ppt: 'Presentazioni PowerPoint (97-2003)', msg: 'Messaggi Outlook', odt: 'Documenti OpenDocument', ods: 'Fogli OpenDocument', odp: 'Presentazioni OpenDocument', epub: 'Libri EPUB', zip: 'Archivi ZIP', rar: 'Archivi RAR', '7z': 'Archivi 7-Zip', apk: 'App Android', jar: 'Archivi Java', mp4: 'Video MP4', mov: 'Video MOV', m4v: 'Video M4V', '3gp': 'Video 3GP', mkv: 'Video MKV', webm: 'Video WebM', avi: 'Video AVI', mp3: 'Audio MP3', m4a: 'Audio M4A', wav: 'Audio WAV', ole: 'Documenti Office', db: 'Database miniature' };

/**
 * @param vol Volume
 * @param region { dataOffset, clusterSize, totalClusters, isFree(index) } or null for RAW (whole volume, 512-byte steps)
 * @param opts { types?: Set<ext>, knownOffsets?: Set<number> }
 */
async function scan(vol, region, ctx, opts = {}) {
  const step = region ? region.clusterSize : 512;
  const start = region ? region.dataOffset : 0;
  const end = region ? region.dataOffset + region.totalClusters * region.clusterSize : vol.size;
  const total = Math.max(1, end - start);
  const items = [];
  const known = opts.knownOffsets || new Set();
  const counts = {};
  let pos = start;
  let lastEmit = 0;
  while (pos < end && !ctx.cancelled()) {
    const len = Math.min(CHUNK, end - pos);
    // skip completely allocated chunks quickly
    if (region && region.isFree) {
      let anyFree = false;
      const c0 = Math.floor((pos - start) / step), c1 = Math.floor((pos + len - start) / step);
      for (let c = c0; c < c1; c += 1) { if (region.isFree(c)) { anyFree = true; break; } }
      if (!anyFree) { pos += len; continue; }
    }
    const buf = Buffer.from(await vol.readAsync(pos, len, true));
    let i = 0;
    while (i + 16 <= buf.length) {
      const abs = pos + i;
      if (region && region.isFree && !region.isFree(Math.floor((abs - start) / step))) { i += step; continue; }
      const parser = detect(buf, i);
      if (parser && !known.has(abs)) {
        let res = null;
        try { res = await parser(makeReader(vol, abs, end - abs)); } catch (e) { res = null; }
        if (res && res.size > 32 && abs + res.size <= end && (!opts.types || opts.types.has(res.ext))) {
          counts[res.ext] = (counts[res.ext] || 0) + 1;
          const name = `${res.ext.toUpperCase()}_${String(counts[res.ext]).padStart(5, '0')}.${res.ext}`;
          items.push({ name, folder: 'Scansione profonda\\' + (GROUP[res.ext] || res.ext.toUpperCase()), size: res.size, mtime: 0, ctime: 0, type: typeOf(name), chance: 'average', source: 'carve', extents: [{ off: abs, len: res.size }], offset: abs });
          // continue after the file (aligned to the next step)
          const skip = Math.ceil(res.size / step) * step;
          if (i + skip < buf.length) { i += skip; continue; }
          pos = abs + skip;
          i = -1;
          break;
        }
      }
      i += step;
    }
    if (i !== -1) pos += len;
    const now = Date.now();
    if (now - lastEmit > 300) {
      lastEmit = now;
      ctx.progress({ percent: Math.min(99, Math.round(((pos - start) / total) * 100)), label: `Scansione profonda… ${items.length} file trovati per firma` });
      await yieldLoop();
    }
  }
  return items;
}

module.exports = { scan, detect, GROUP };
