// Structural repair of damaged files: JPEG, PNG, PDF, ZIP / Office / OpenDocument
const zlib = require('zlib');
const ziplib = require('./ziplib');

function detect(buf, ext) {
  ext = (ext || '').toLowerCase();
  if (buf.indexOf(Buffer.from([0xFF, 0xD8, 0xFF])) === 0 || /^(jpe?g|jfif)$/.test(ext)) return 'jpeg';
  if (buf.indexOf(Buffer.from([0x89, 0x50, 0x4E, 0x47])) === 0 || ext === 'png') return 'png';
  if (buf.indexOf('%PDF') >= 0 && buf.indexOf('%PDF') < 1024 || ext === 'pdf') return 'pdf';
  if (buf.readUInt32LE(0) === 0x04034b50 || ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar', 'apk'].includes(ext)) return 'zip';
  return null;
}

// ----------------------------------------------------------------- JPEG
function jpegSegments(buf, start) {
  // returns { ok, sosEnd } where sosEnd is the offset of entropy data after the SOS segment
  let p = start + 2;
  for (let g = 0; g < 1000 && p + 4 <= buf.length; g++) {
    if (buf[p] !== 0xFF) return { ok: false, at: p };
    const m = buf[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (len < 2) return { ok: false, at: p };
    if (m === 0xDA) return { ok: true, sos: p, sosEnd: p + 2 + len };
    p += 2 + len;
  }
  return { ok: false, at: p };
}

function repairJpeg(buf, ref) {
  const notes = [];
  let start = buf.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]));
  let out = null;
  if (start > 0) notes.push(`Rimossi ${start} byte non validi all'inizio del file`);
  let seg = start >= 0 ? jpegSegments(buf, start) : { ok: false };
  if (seg.ok) out = buf.subarray(start);
  if (!seg.ok) {
    if (!ref) return { ok: false, error: 'Intestazione JPEG danneggiata: aggiungi una foto di riferimento scattata con lo stesso dispositivo (stessa risoluzione) per la riparazione avanzata.' };
    const rs = ref.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]));
    const rseg = rs >= 0 ? jpegSegments(ref, rs) : { ok: false };
    if (!rseg.ok) return { ok: false, error: 'Anche la foto di riferimento non è un JPEG valido.' };
    // entropy data of the damaged file: after its own SOS segment if present, otherwise after the last marker found
    let dataStart = -1;
    const sos = buf.lastIndexOf(Buffer.from([0xFF, 0xDA]), Math.min(buf.length, 512 * 1024));
    if (sos >= 0 && sos + 4 < buf.length) dataStart = sos + 2 + buf.readUInt16BE(sos + 2);
    if (dataStart < 0) dataStart = Math.min(buf.length, (seg.at || 0) + 0);
    out = Buffer.concat([ref.subarray(rs, rseg.sosEnd), buf.subarray(dataStart)]);
    notes.push('Intestazione ricostruita dalla foto di riferimento');
  }
  // end of image
  const eoi = out.lastIndexOf(Buffer.from([0xFF, 0xD9]));
  const s2 = jpegSegments(out, 0);
  if (eoi > (s2.sosEnd || 0)) {
    if (eoi + 2 < out.length) { notes.push(`Rimossi ${out.length - eoi - 2} byte dopo la fine dell'immagine`); out = out.subarray(0, eoi + 2); }
  } else { out = Buffer.concat([out, Buffer.from([0xFF, 0xD9])]); notes.push('File troncato: aggiunto il marcatore di fine immagine (la parte mancante resterà grigia)'); }
  return { ok: true, data: out, ext: 'jpg', notes };
}

// ----------------------------------------------------------------- PNG
function repairPng(buf) {
  const notes = [];
  const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  let p = buf.indexOf(Buffer.from('IHDR')) - 4;
  if (p < 0) return { ok: false, error: 'Intestazione PNG (IHDR) non trovata' };
  if (p !== 8 || !buf.subarray(0, 8).equals(SIG)) notes.push('Firma PNG ripristinata');
  const chunks = [SIG];
  let fixed = 0, iend = false, skipped = 0;
  const KNOWN = ['IDAT', 'IEND', 'PLTE', 'tRNS', 'tEXt', 'zTXt', 'iTXt', 'pHYs', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'bKGD', 'tIME', 'eXIf', 'acTL', 'fcTL', 'fdAT'];
  const resync = (from) => {
    let best = -1;
    for (const k of KNOWN) { const i = buf.indexOf(k, from, 'latin1'); if (i >= 4 && (best < 0 || i < best)) best = i; }
    return best < 0 ? -1 : best - 4;
  };
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    let type = buf.toString('latin1', p + 4, p + 8);
    if (!/^[A-Za-z]{4}$/.test(type) && len <= buf.length && p + 12 + len <= buf.length) {
      // damaged chunk name but plausible length: if the next chunk lines up (or the file ends), it is most likely image data
      const nx = p + 12 + len;
      const nextOk = nx + 8 > buf.length || /^[A-Za-z]{4}$/.test(buf.toString('latin1', nx + 4, nx + 8));
      if (nextOk && !chunks.some((c) => c.length >= 4 && c.toString('latin1', 0, 4) === 'IDAT')) {
        type = 'IDAT';
        buf = Buffer.from(buf); buf.write('IDAT', p + 4, 'latin1');
        notes.push('Nome del blocco dati immagine ripristinato');
      }
    }
    if (!/^[A-Za-z]{4}$/.test(type) || len > buf.length) {
      const n = resync(p + 8);
      if (n < 0) { notes.push('Dati non validi dopo l\'ultimo blocco: troncati'); break; }
      skipped++; p = n; continue;
    }
    if (p + 12 + len > buf.length) { notes.push(`Blocco ${type} incompleto: rimosso`); break; }
    const body = buf.subarray(p + 4, p + 8 + len);
    const crc = ziplib.crc32(body);
    if (crc !== buf.readUInt32BE(p + 8 + len)) fixed++;
    const c = Buffer.alloc(4); c.writeUInt32BE(crc);
    const l = Buffer.alloc(4); l.writeUInt32BE(len);
    chunks.push(l, body, c);
    p += 12 + len;
    if (type === 'IEND') { iend = true; break; }
  }
  if (fixed) notes.push(`${fixed} checksum CRC corretti`);
  if (skipped) notes.push(`${skipped} blocchi danneggiati saltati`);
  if (!iend) {
    const body = Buffer.from('IEND'); const c = Buffer.alloc(4); c.writeUInt32BE(ziplib.crc32(body));
    chunks.push(Buffer.from([0, 0, 0, 0]), body, c);
    notes.push('Aggiunto il blocco finale IEND');
  }
  return { ok: true, data: Buffer.concat(chunks), ext: 'png', notes };
}

// ----------------------------------------------------------------- PDF
function repairPdf(buf) {
  const notes = [];
  const start = buf.indexOf('%PDF');
  if (start < 0) return { ok: false, error: 'Intestazione PDF non trovata' };
  if (start > 0) notes.push(`Rimossi ${start} byte non validi all'inizio`);
  let body = buf.subarray(start);
  const s = body.toString('latin1');
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const objs = new Map();
  let m, lastEnd = 0, root = null, info = null, maxNum = 0;
  while ((m = re.exec(s))) {
    const num = +m[1], gen = +m[2];
    if (num > 10000000) continue;
    objs.set(num, { off: m.index, gen });
    maxNum = Math.max(maxNum, num);
    const end = s.indexOf('endobj', m.index);
    const head = s.slice(m.index, Math.min(end > 0 ? end : m.index + 2000, m.index + 2000));
    if (/\/Type\s*\/Catalog/.test(head)) root = `${num} ${gen} R`;
    if (!info && /\/(Producer|Creator|CreationDate)/.test(head) && !/\/Type/.test(head)) info = `${num} ${gen} R`;
    if (end > lastEnd) lastEnd = end + 6;
  }
  const tr = s.match(/\/Root\s+(\d+\s+\d+\s+R)/g);
  if (tr && tr.length) root = tr[tr.length - 1].replace(/\/Root\s+/, '');
  if (!objs.size) return { ok: false, error: 'Nessun oggetto PDF leggibile' };
  if (!root) return { ok: false, error: 'Catalogo del documento non trovato (il PDF usa probabilmente flussi compressi danneggiati)' };
  body = body.subarray(0, lastEnd);
  let xref = `\nxref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxNum; i++) {
    const o = objs.get(i);
    xref += o ? `${String(o.off).padStart(10, '0')} ${String(o.gen).padStart(5, '0')} n \n` : '0000000000 65535 f \n';
  }
  const xrefPos = body.length + 1;
  const trailer = `trailer\n<< /Size ${maxNum + 1} /Root ${root}${info ? ' /Info ' + info : ''} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  notes.push(`Tabella dei riferimenti ricostruita (${objs.size} oggetti)`);
  return { ok: true, data: Buffer.concat([body, Buffer.from(xref + trailer, 'latin1')]), ext: 'pdf', notes };
}

// ----------------------------------------------------------------- ZIP / Office
function repairZip(buf, ext) {
  const start = buf.indexOf(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
  if (start < 0) return { ok: false, error: 'Nessun contenuto ZIP riconoscibile' };
  const r = ziplib.rebuild(buf.subarray(start));
  if (!r.kept) return { ok: false, error: 'Nessun elemento dell\'archivio è recuperabile' };
  const notes = [`${r.kept} elementi recuperati`];
  if (r.lost.length) notes.push(`${r.lost.length} elementi persi: ${r.lost.slice(0, 5).join(', ')}${r.lost.length > 5 ? '…' : ''}`);
  if (r.partial.length) notes.push(`${r.partial.length} elementi recuperati solo in parte`);
  const names = ziplib.entries(r.data).map((e) => e.name);
  const need = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml', odt: 'content.xml', ods: 'content.xml', odp: 'content.xml' }[ext];
  if (need && !names.includes(need)) notes.push(`Attenzione: la parte principale (${need}) è andata persa, il documento potrebbe non aprirsi`);
  return { ok: true, data: r.data, ext: ext || 'zip', notes };
}

function repair(buf, ext, ref) {
  const t = detect(buf, ext);
  if (t === 'jpeg') return repairJpeg(buf, ref);
  if (t === 'png') return repairPng(buf);
  if (t === 'pdf') return repairPdf(buf);
  if (t === 'zip') return repairZip(buf, ext);
  return { ok: false, error: 'Formato non supportato per la riparazione (supportati: JPEG, PNG, PDF, ZIP, Word, Excel, PowerPoint, OpenDocument)' };
}

module.exports = { repair, detect };
