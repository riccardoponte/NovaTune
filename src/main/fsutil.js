// File-system helpers shared by cleaners
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function env(p) {
  return p.replace(/%([^%]+)%/g, (m, n) => {
    const k = Object.keys(process.env).find((x) => x.toLowerCase() === n.toLowerCase());
    return k ? process.env[k] : m;
  });
}

function globToRegex(g) {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/**
 * Walk a directory collecting files.
 * opts: { recursive=true, pattern, minAgeMs, maxDepth, onFile(file, stat), dirFilter(name) }
 */
async function walk(root, opts = {}, depth = 0, out = { files: [], size: 0, count: 0 }) {
  const recursive = opts.recursive !== false;
  const re = opts.pattern ? (opts.pattern instanceof RegExp ? opts.pattern : globToRegex(opts.pattern)) : null;
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return out; }
  const now = Date.now();
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (recursive && (opts.maxDepth == null || depth < opts.maxDepth)) {
        if (opts.dirFilter && !opts.dirFilter(ent.name, full)) continue;
        await walk(full, opts, depth + 1, out);
      }
      continue;
    }
    if (re && !re.test(ent.name)) continue;
    let st;
    try { st = await fsp.stat(full); } catch (e) { continue; }
    if (opts.minAgeMs && now - st.mtimeMs < opts.minAgeMs) continue;
    out.size += st.size;
    out.count++;
    if (opts.collect !== false) out.files.push({ path: full, size: st.size, mtime: st.mtimeMs });
    if (opts.onFile) opts.onFile(full, st);
  }
  return out;
}

async function exists(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }

/** Delete a list of files; returns {deleted, freed, failed} */
async function deleteFiles(files, onProgress) {
  let deleted = 0, freed = 0, failed = 0, i = 0;
  for (const f of files) {
    i++;
    try {
      await fsp.unlink(f.path);
      deleted++; freed += f.size || 0;
    } catch (e) {
      try { await fsp.chmod(f.path, 0o666); await fsp.unlink(f.path); deleted++; freed += f.size || 0; }
      catch (e2) { failed++; }
    }
    if (onProgress && i % 200 === 0) onProgress(i, files.length);
  }
  return { deleted, freed, failed };
}

/** Remove empty sub directories (keeps root) */
async function removeEmptyDirs(root, keepRoot = true) {
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return false; }
  let empty = true;
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory() && !ent.isSymbolicLink()) {
      const sub = await removeEmptyDirs(full, false);
      if (!sub) empty = false;
    } else empty = false;
  }
  if (empty && !keepRoot) {
    try { await fsp.rmdir(root); return true; } catch (e) { return false; }
  }
  return empty;
}

async function dirSize(p) {
  const r = await walk(p, { collect: false });
  return { size: r.size, count: r.count };
}

/** Expand a path that may contain a single '*' directory wildcard segment, e.g. %LOCALAPPDATA%\Packages\*\AC\INetCache */
async function expandWildcardDirs(p) {
  p = env(p);
  const parts = p.split(/[\\/]/);
  let bases = [parts[0] + '\\'];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    const next = [];
    if (seg.includes('*') || seg.includes('?')) {
      const re = globToRegex(seg);
      for (const b of bases) {
        let ents = [];
        try { ents = await fsp.readdir(b, { withFileTypes: true }); } catch (e) {}
        for (const e of ents) if (e.isDirectory() && re.test(e.name)) next.push(path.join(b, e.name));
      }
    } else {
      for (const b of bases) next.push(path.join(b, seg));
    }
    bases = next;
    if (!bases.length) break;
  }
  const out = [];
  for (const b of bases) if (await exists(b)) out.push(b);
  return out;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

module.exports = { env, walk, exists, deleteFiles, removeEmptyDirs, dirSize, expandWildcardDirs, globToRegex, fmtBytes };
