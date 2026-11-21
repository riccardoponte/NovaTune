// Windows thumbnail cache (thumbcache_*.db) extractor.
// Explorer keeps thumbnails of pictures and videos here, often even after the original file was deleted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cacheDir() { return path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Explorer'); }

function imageKind(b, o) {
  if (b[o] === 0xFF && b[o + 1] === 0xD8) return 'jpg';
  if (b[o] === 0x89 && b[o + 1] === 0x50 && b[o + 2] === 0x4E && b[o + 3] === 0x47) return 'png';
  if (b[o] === 0x42 && b[o + 1] === 0x4D) return 'bmp';
  return null;
}

function parseFile(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return { entries: [], error: e.code }; }
  if (buf.toString('latin1', 0, 4) !== 'CMMM') return { entries: [] };
  const entries = [];
  let pos = 24;
  let guard = 0;
  while (pos + 0x40 < buf.length && guard++ < 200000) {
    if (buf.toString('latin1', pos, pos + 4) !== 'CMMM') {
      const nxt = buf.indexOf('CMMM', pos + 1, 'latin1');
      if (nxt < 0) break;
      pos = nxt;
      continue;
    }
    const entrySize = buf.readUInt32LE(pos + 4);
    if (entrySize < 0x28 || pos + entrySize > buf.length) { pos += 4; continue; }
    const hash = buf.readBigUInt64LE(pos + 8).toString(16);
    let found = null;
    for (const h of [0x38, 0x30, 0x40, 0x28]) {
      const idSize = buf.readUInt32LE(pos + 0x10), padSize = buf.readUInt32LE(pos + 0x14), dataSize = buf.readUInt32LE(pos + 0x18);
      const dataStart = pos + h + idSize + padSize;
      if (!dataSize || dataStart + dataSize > pos + entrySize + 8) continue;
      const kind = imageKind(buf, dataStart);
      if (kind) { found = { dataStart, dataSize, kind, w: h >= 0x38 ? buf.readUInt32LE(pos + 0x1C) : 0, h: h >= 0x38 ? buf.readUInt32LE(pos + 0x20) : 0 }; break; }
    }
    if (found) entries.push({ hash, file, offset: found.dataStart, size: found.dataSize, kind: found.kind, w: found.w, h: found.h, data: buf.subarray(found.dataStart, found.dataStart + found.dataSize) });
    pos += entrySize;
  }
  return { entries };
}

let lastList = null;

async function list(ctx) {
  const dir = cacheDir();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^thumbcache_.*\.db$/i.test(f) && !/idx/i.test(f)); } catch (e) {}
  const byHash = new Map();
  const errors = [];
  let n = 0;
  for (const f of files) {
    n++;
    if (ctx && ctx.progress) ctx.progress({ percent: Math.round((n / files.length) * 100), label: `Lettura di ${f}…` });
    const r = parseFile(path.join(dir, f));
    if (r.error) errors.push(`${f}: ${r.error}`);
    for (const e of r.entries) {
      const g = byHash.get(e.hash) || { hash: e.hash, variants: [] };
      g.variants.push(e);
      byHash.set(e.hash, g);
    }
  }
  const seen = new Set();
  const out = [];
  for (const g of byHash.values()) {
    g.variants.sort((a, b) => b.size - a.size);
    const best = g.variants[0];
    const digest = crypto.createHash('sha1').update(best.data).digest('hex');
    if (seen.has(digest)) continue;
    seen.add(digest);
    const small = g.variants.filter((v) => v.kind !== 'bmp').sort((a, b) => a.size - b.size).find((v) => v.size > 1500) || best;
    out.push({ id: g.hash, w: best.w, h: best.h, size: best.size, kind: best.kind, preview: `data:image/${small.kind === 'jpg' ? 'jpeg' : small.kind};base64,` + small.data.toString('base64'), _best: best });
  }
  lastList = out;
  return { items: out.map(({ _best, ...x }) => x), files: files.length, errors };
}

async function exportAll(ids, dest) {
  if (!lastList) throw new Error('Esegui prima la lettura della cache');
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const it of lastList) {
    if (ids && !ids.includes(it.id)) continue;
    fs.writeFileSync(path.join(dest, `miniatura_${it.id}.${it._best.kind}`), it._best.data);
    n++;
  }
  return { exported: n, destination: dest };
}

module.exports = { list, exportAll, parseFile };
