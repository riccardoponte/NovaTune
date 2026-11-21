// Data Shredder: secure deletion with Quick / Random / DoD 5220.22-M / Gutmann algorithms
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const ps = require('../ps');

const CHUNK = 1024 * 1024;

const GUTMANN_FIXED = [[0x55], [0xAA], [0x92, 0x49, 0x24], [0x49, 0x24, 0x92], [0x24, 0x92, 0x49], [0x00], [0x11], [0x22], [0x33], [0x44], [0x55], [0x66], [0x77], [0x88], [0x99], [0xAA], [0xBB], [0xCC], [0xDD], [0xEE], [0xFF], [0x92, 0x49, 0x24], [0x49, 0x24, 0x92], [0x24, 0x92, 0x49], [0x6D, 0xB6, 0xDB], [0xB6, 0xDB, 0x6D], [0xDB, 0x6D, 0xB6]];

const ALGORITHMS = {
  quick: { name: 'Rapido (1 passaggio con zeri)', passes: () => [[0x00]] },
  random: { name: 'Dati casuali', passes: (n) => Array.from({ length: Math.max(1, n || 1) }, () => 'random') },
  dod: { name: 'DoD 5220.22-M (3 passaggi)', passes: () => [[0x00], [0xFF], 'random'] },
  gutmann: { name: 'Gutmann (35 passaggi)', passes: () => ['random', 'random', 'random', 'random', ...GUTMANN_FIXED, 'random', 'random', 'random', 'random'] }
};

let cancelFlag = false;

function patternBuffer(p) {
  if (p === 'random') return null;
  const b = Buffer.alloc(CHUNK);
  for (let i = 0; i < CHUNK; i++) b[i] = p[i % p.length];
  return b;
}

async function collect(paths) {
  const files = [];
  const dirs = [];
  async function rec(p) {
    let st;
    try { st = await fsp.lstat(p); } catch (e) { return; }
    if (st.isSymbolicLink()) { files.push({ path: p, size: 0, link: true }); return; }
    if (st.isDirectory()) {
      dirs.push(p);
      let ents = [];
      try { ents = await fsp.readdir(p); } catch (e) {}
      for (const e of ents) await rec(path.join(p, e));
    } else files.push({ path: p, size: st.size });
  }
  for (const p of paths) await rec(p);
  return { files, dirs: dirs.reverse() };
}

async function wipeFile(f, passes, onBytes) {
  if (f.link) { await fsp.unlink(f.path); return; }
  try { await fsp.chmod(f.path, 0o666); } catch (e) {}
  const fh = await fsp.open(f.path, 'r+');
  try {
    for (const p of passes) {
      if (cancelFlag) throw new Error('cancelled');
      const fixed = patternBuffer(p);
      let pos = 0;
      while (pos < f.size) {
        if (cancelFlag) throw new Error('cancelled');
        const len = Math.min(CHUNK, f.size - pos);
        const buf = fixed ? fixed : crypto.randomBytes(len);
        await fh.write(buf, 0, len, pos);
        pos += len;
        onBytes(len);
      }
      await fh.sync();
    }
    await fh.truncate(0);
    await fh.sync();
  } finally { await fh.close(); }
  // obfuscate the name in the MFT before deletion
  let cur = f.path;
  for (let i = 0; i < 3; i++) {
    const nn = path.join(path.dirname(cur), crypto.randomBytes(8).toString('hex'));
    try { await fsp.rename(cur, nn); cur = nn; } catch (e) { break; }
  }
  await fsp.unlink(cur);
}

async function shred(opts, ctx = {}) {
  cancelFlag = false;
  const s = store.settings();
  const algo = ALGORITHMS[opts.algorithm || s.shredAlgorithm] || ALGORITHMS.dod;
  const passes = algo.passes(opts.passes || s.shredPasses);
  const { files, dirs } = await collect(opts.paths || []);
  const total = files.reduce((a, f) => a + f.size, 0) * passes.length || 1;
  let done = 0, shredded = 0;
  const failed = [];
  let lastEmit = 0;
  const onBytes = (n) => {
    done += n;
    const now = Date.now();
    if (ctx.progress && now - lastEmit > 250) { lastEmit = now; ctx.progress({ percent: Math.min(99, Math.round((done / total) * 100)), label: `Distruzione in corso… ${shredded}/${files.length} file` }); }
  };
  for (const f of files) {
    if (cancelFlag) break;
    try { await wipeFile(f, passes, onBytes); shredded++; }
    catch (e) { if (e.message === 'cancelled') break; failed.push({ path: f.path, error: e.code === 'EBUSY' ? 'File in uso' : e.code === 'EPERM' || e.code === 'EACCES' ? 'Accesso negato' : String(e.message) }); }
  }
  for (const d of dirs) {
    try {
      const nn = path.join(path.dirname(d), crypto.randomBytes(8).toString('hex'));
      await fsp.rename(d, nn); await fsp.rmdir(nn);
    } catch (e) { try { await fsp.rmdir(d); } catch (e2) {} }
  }
  store.addStat('filesShredded', shredded, { type: 'shredder', items: shredded });
  return { shredded, failed, cancelled: cancelFlag, algorithm: algo.name };
}

/** Wipe the free space of a drive by filling it with a temporary file */
async function wipeFreeSpace(opts, ctx = {}) {
  cancelFlag = false;
  const root = opts.letter + ':\\';
  const dir = path.join(root, 'NovaTune_Wipe_' + crypto.randomBytes(4).toString('hex'));
  await fsp.mkdir(dir, { recursive: true });
  const info = await ps.json(`$d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $A.l + ":'"); Emit-Result @{ free = [int64]$d.FreeSpace }`, { args: { l: opts.letter } });
  const target = info.free;
  let written = 0, fileIdx = 0;
  const zero = Buffer.alloc(CHUNK * 4);
  try {
    outer: while (!cancelFlag) {
      const fh = await fsp.open(path.join(dir, `w${fileIdx++}.tmp`), 'w');
      let fileBytes = 0;
      try {
        while (fileBytes < 2 * 1024 * 1024 * 1024) { // 2 GB per file
          if (cancelFlag) break outer;
          const buf = opts.random ? crypto.randomBytes(zero.length) : zero;
          try { await fh.write(buf, 0, buf.length); } catch (e) { break outer; }
          fileBytes += buf.length; written += buf.length;
          if (ctx.progress) ctx.progress({ percent: Math.min(99, Math.round((written / target) * 100)), label: 'Sovrascrittura dello spazio libero…' });
        }
      } finally { try { await fh.close(); } catch (e) {} }
    }
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (e) {}
  }
  return { written, cancelled: cancelFlag };
}

function cancel() { cancelFlag = true; return { ok: true }; }

function algorithms() { return Object.entries(ALGORITHMS).map(([id, a]) => ({ id, name: a.name })); }

module.exports = { shred, wipeFreeSpace, cancel, algorithms };
