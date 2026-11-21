// Minimal ZIP reader/writer (no dependencies): used for Office/OpenDocument preview and ZIP/Office repair
const zlib = require('zlib');

const crc32 = zlib.crc32 ? (b) => zlib.crc32(b) >>> 0 : (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();

/** Entries from the central directory (healthy archives) */
function centralEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return null;
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff >= buf.length) return null;
  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), cs = buf.readUInt32LE(p + 20), us = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (lho + 30 > buf.length) return null;
    const dataOffset = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    out.push({ name, method, crc, compSize: cs, size: us, dataOffset });
    p += 46 + nl + xl + cl;
  }
  return out;
}

/** Entries found by scanning local headers (damaged archives) */
function scanLocal(buf) {
  const sig = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  const out = [];
  let p = buf.indexOf(sig);
  while (p >= 0 && p + 30 <= buf.length) {
    const flags = buf.readUInt16LE(p + 6), method = buf.readUInt16LE(p + 8);
    let crc = buf.readUInt32LE(p + 14), cs = buf.readUInt32LE(p + 18), us = buf.readUInt32LE(p + 22);
    const nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nl);
    const dataOffset = p + 30 + nl + xl;
    let next = buf.indexOf(sig, dataOffset);
    const cdir = buf.indexOf(Buffer.from([0x50, 0x4B, 0x01, 0x02]), dataOffset);
    let end = [next, cdir].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (end == null) end = buf.length;
    if ((flags & 0x08) || !cs || dataOffset + cs > buf.length) {
      // sizes are in the data descriptor (or broken): find it before the next header
      const dd = buf.lastIndexOf(Buffer.from([0x50, 0x4B, 0x07, 0x08]), end);
      if (dd >= dataOffset && dd + 16 <= buf.length) { crc = buf.readUInt32LE(dd + 4); cs = buf.readUInt32LE(dd + 8); us = buf.readUInt32LE(dd + 12); }
      else { cs = end - dataOffset; crc = null; us = null; }
    }
    if (name && dataOffset <= buf.length) out.push({ name, method, crc, compSize: Math.min(cs, buf.length - dataOffset), size: us, dataOffset, local: p });
    p = next;
  }
  return out;
}

function extract(buf, e) {
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    try { return zlib.inflateRawSync(raw); }
    catch (err) {
      // salvage: decompress as much as possible
      try { return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (e2) { return null; }
    }
  }
  return null;
}

function entries(buf) { return centralEntries(buf) || scanLocal(buf); }

function xmlText(xml, paraTag) {
  return xml.replace(new RegExp(`</${paraTag}>`, 'g'), '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}

/** Text/thumbnail preview of Office, OpenDocument and ZIP files */
function previewOffice(buf, ext) {
  const list = entries(buf);
  const get = (n) => { const e = list.find((x) => x.name === n); return e ? extract(buf, e) : null; };
  const thumb = list.find((x) => /^(docProps\/thumbnail\.(jpe?g|png)|Thumbnails\/thumbnail\.png)$/i.test(x.name));
  let text = '';
  if (ext === 'docx') { const d = get('word/document.xml'); if (d) text = xmlText(d.toString('utf8'), 'w:p'); }
  else if (ext === 'xlsx') { const d = get('xl/sharedStrings.xml'); if (d) text = (d.toString('utf8').match(/<t[^>]*>[^<]*<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('  ·  '); }
  else if (ext === 'pptx') {
    const slides = list.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x.name)).sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));
    text = slides.map((s, i) => `— Diapositiva ${i + 1} —\n` + xmlText((extract(buf, s) || Buffer.alloc(0)).toString('utf8'), 'a:p')).join('\n\n');
  } else if (['odt', 'ods', 'odp'].includes(ext)) { const d = get('content.xml'); if (d) text = xmlText(d.toString('utf8'), 'text:p'); }
  const res = { kind: 'text', text: text.slice(0, 200000), entries: list.slice(0, 300).map((e) => ({ name: e.name, size: e.size })) };
  if (!text) res.kind = 'zip';
  if (thumb) { const d = extract(buf, thumb); if (d) { res.thumb = d; res.thumbMime = /png$/i.test(thumb.name) ? 'image/png' : 'image/jpeg'; } }
  return res;
}

/** Rebuild a damaged ZIP/Office archive from the entries that can still be read */
function rebuild(buf) {
  const found = scanLocal(buf);
  const good = [], bad = [];
  for (const e of found) {
    const data = extract(buf, e);
    if (!data) { bad.push(e.name); continue; }
    const crc = crc32(data);
    if (e.crc != null && e.crc !== crc && e.method === 0) { bad.push(e.name); continue; }
    // re-compress to guarantee a consistent stream
    const comp = e.method === 0 ? data : zlib.deflateRawSync(data);
    good.push({ name: e.name, method: e.method === 0 ? 0 : 8, crc, size: data.length, comp, partial: e.crc != null && e.crc !== crc });
  }
  const parts = [], central = [];
  let off = 0;
  for (const g of good) {
    const nameB = Buffer.from(g.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(g.method, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(g.crc, 14); lh.writeUInt32LE(g.comp.length, 18); lh.writeUInt32LE(g.size, 22); lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameB, g.comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(g.method, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(g.crc, 16); ch.writeUInt32LE(g.comp.length, 20); ch.writeUInt32LE(g.size, 24); ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nameB);
    off += 30 + nameB.length + g.comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(good.length, 8); eocd.writeUInt16LE(good.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return { data: Buffer.concat([...parts, cd, eocd]), kept: good.length, partial: good.filter((g) => g.partial).map((g) => g.name), lost: bad };
}

module.exports = { entries, extract, previewOffice, rebuild, crc32 };
