// File Repair module (UI entry points)
const fs = require('fs');
const path = require('path');
const lib = require('../recovery/repair');
const ziplib = require('../recovery/ziplib');
const store = require('../store');

const MAX = 1024 * 1024 * 1024;

async function repairFiles(opts, ctx = {}) {
  const results = [];
  let n = 0;
  for (const f of opts.files) {
    n++;
    if (ctx.progress) ctx.progress({ percent: Math.round(((n - 1) / opts.files.length) * 100), label: `Riparazione di ${path.basename(f.path)}…` });
    try {
      const st = fs.statSync(f.path);
      if (st.size > MAX) throw new Error('File troppo grande (oltre 1 GB)');
      const buf = fs.readFileSync(f.path);
      const ref = f.ref ? fs.readFileSync(f.ref) : null;
      const ext = path.extname(f.path).slice(1).toLowerCase();
      const r = lib.repair(buf, ext, ref);
      if (!r.ok) { results.push({ path: f.path, ok: false, error: r.error }); continue; }
      const dir = opts.destination || path.join(path.dirname(f.path), 'Riparati');
      fs.mkdirSync(dir, { recursive: true });
      const base = path.basename(f.path, path.extname(f.path));
      let out = path.join(dir, `${base}_riparato.${r.ext}`);
      let k = 1;
      while (fs.existsSync(out)) out = path.join(dir, `${base}_riparato (${k++}).${r.ext}`);
      fs.writeFileSync(out, r.data);
      results.push({ path: f.path, ok: true, output: out, notes: r.notes, size: r.data.length });
    } catch (e) { results.push({ path: f.path, ok: false, error: String(e.message || e) }); }
  }
  store.addStat('filesRepaired', results.filter((r) => r.ok).length, { type: 'repair', items: results.filter((r) => r.ok).length });
  return { results };
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

/** Preview of a file on disk (used to compare damaged vs repaired) */
async function previewFile(opts) {
  const ext = path.extname(opts.path).slice(1).toLowerCase();
  const st = fs.statSync(opts.path);
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'epub'].includes(ext)) {
    if (st.size > 200 * 1024 * 1024) return { kind: 'none', reason: 'File troppo grande' };
    return Object.assign({ name: path.basename(opts.path), size: st.size }, ziplib.previewOffice(fs.readFileSync(opts.path), ext));
  }
  const mime = MIME[ext];
  if (!mime || st.size > 100 * 1024 * 1024) return { kind: 'none', name: path.basename(opts.path), size: st.size };
  return { kind: mime === 'application/pdf' ? 'pdf' : 'image', mime, name: path.basename(opts.path), size: st.size, data: fs.readFileSync(opts.path) };
}

module.exports = { repairFiles, previewFile };
