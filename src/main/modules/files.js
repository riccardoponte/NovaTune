// Large files & duplicate files finder
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const store = require('../store');

let cancelFlag = false;
const SKIP = /^(\$recycle\.bin|system volume information|windows|winsxs|\$windows\.~bt|\$winreagent|programdata\\microsoft|config\.msi|recovery)$/i;

async function walkAll(root, onFile, ctx, state) {
  let ents;
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (cancelFlag) return;
    const full = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP.test(e.name) || e.name.startsWith('$')) continue;
      state.dirs++;
      if (state.dirs % 300 === 0 && ctx.progress) { ctx.progress({ label: `Analisi: ${full.slice(0, 90)}`, percent: -1 }); await new Promise((r) => setImmediate(r)); }
      await walkAll(full, onFile, ctx, state);
    } else if (e.isFile()) {
      let st; try { st = await fsp.stat(full); } catch (er) { continue; }
      onFile(full, st);
    }
  }
}

async function large(opts = {}, ctx = {}) {
  cancelFlag = false;
  const roots = opts.roots && opts.roots.length ? opts.roots : [os.homedir()];
  const min = (opts.minMB || 100) * 1024 * 1024;
  const out = [];
  const state = { dirs: 0 };
  for (const r of roots) await walkAll(r, (f, st) => { if (st.size >= min) out.push({ path: f, name: path.basename(f), size: st.size, mtime: st.mtimeMs, atime: st.atimeMs }); }, ctx, state);
  out.sort((a, b) => b.size - a.size);
  return { items: out.slice(0, 3000), cancelled: cancelFlag };
}

async function hashFile(f, partial) {
  const h = crypto.createHash('sha1');
  const fh = await fsp.open(f, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    if (partial) {
      const { bytesRead } = await fh.read(buf, 0, 64 * 1024, 0);
      h.update(buf.subarray(0, bytesRead));
    } else {
      let pos = 0;
      for (;;) {
        if (cancelFlag) throw new Error('cancelled');
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        h.update(buf.subarray(0, bytesRead)); pos += bytesRead;
      }
    }
  } finally { await fh.close(); }
  return h.digest('hex');
}

async function duplicates(opts = {}, ctx = {}) {
  cancelFlag = false;
  const roots = opts.roots && opts.roots.length ? opts.roots : [os.homedir()];
  const min = (opts.minKB || 100) * 1024;
  const bySize = new Map();
  const state = { dirs: 0 };
  for (const r of roots) await walkAll(r, (f, st) => { if (st.size >= min) { const a = bySize.get(st.size) || []; a.push({ path: f, size: st.size, mtime: st.mtimeMs }); bySize.set(st.size, a); } }, ctx, state);
  const groups = [];
  const cand = [...bySize.values()].filter((a) => a.length > 1);
  let i = 0;
  for (const files of cand) {
    if (cancelFlag) break;
    i++;
    if (ctx.progress && i % 20 === 0) ctx.progress({ percent: Math.round((i / cand.length) * 100), label: `Confronto dei file (${i}/${cand.length})…` });
    const byPartial = new Map();
    for (const f of files) { try { const k = await hashFile(f.path, true); (byPartial.get(k) || byPartial.set(k, []).get(k)).push(f); } catch (e) {} }
    for (const g of byPartial.values()) {
      if (g.length < 2) continue;
      const byFull = new Map();
      for (const f of g) { try { const k = await hashFile(f.path, false); (byFull.get(k) || byFull.set(k, []).get(k)).push(f); } catch (e) {} }
      for (const [k, gg] of byFull) if (gg.length > 1) groups.push({ hash: k, size: gg[0].size, files: gg.sort((a, b) => a.mtime - b.mtime) });
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return { groups: groups.slice(0, 2000), wasted: groups.reduce((a, g) => a + g.size * (g.files.length - 1), 0), cancelled: cancelFlag };
}

async function remove(opts) {
  const { shell } = require('electron');
  let n = 0, freed = 0; const failed = [];
  for (const f of opts.files) {
    try {
      if (opts.permanent) await fsp.unlink(f.path); else await shell.trashItem(f.path);
      n++; freed += f.size || 0;
    } catch (e) { failed.push(f.path); }
  }
  store.addStat('spaceFreed', freed, { type: 'files', items: n, bytes: freed });
  return { removed: n, freed, failed };
}

function cancel() { cancelFlag = true; return { ok: true }; }

module.exports = { large, duplicates, remove, cancel };
