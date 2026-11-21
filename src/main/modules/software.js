// Software Updater based on Windows Package Manager (winget)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ps = require('../ps');
const store = require('../store');

function wingetPath() {
  const la = process.env.LOCALAPPDATA || '';
  const p = path.join(la, 'Microsoft', 'WindowsApps', 'winget.exe');
  if (fs.existsSync(p)) return p;
  return 'winget.exe';
}

function runWinget(args, onLine, timeout = 0) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(wingetPath(), args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, out: '', missing: true }); }
    let out = '';
    let timer = timeout ? setTimeout(() => { try { child.kill(); } catch (e) {} }, timeout) : null;
    const onData = (d) => {
      const s = d.toString('utf8');
      out += s;
      if (onLine) s.split(/[\r\n]+/).forEach((l) => l.trim() && onLine(l.trim()));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out, missing: true }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

/** Parse winget tables (works with any UI language: columns are located from the header line) */
function parseTables(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^.*\r/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!/^-{10,}\s*$/.test(lines[i])) continue;
    const header = Array.from(lines[i - 1]);
    const starts = [];
    for (let c = 0; c < header.length; c++) if (header[c] !== ' ' && (c === 0 || header[c - 1] === ' ')) starts.push(c);
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (!raw.trim() || /^-{10,}/.test(raw)) break;
      const ch = Array.from(raw);
      if (ch.length < starts[starts.length - 1]) break; // footer text ("N upgrades available")
      const cols = starts.map((s, k) => ch.slice(s, k + 1 < starts.length ? starts[k + 1] : ch.length).join('').trim());
      rows.push(cols);
    }
  }
  return rows;
}

async function available() {
  const r = await runWinget(['--version']);
  return { available: !r.missing && r.code === 0, version: (r.out || '').trim() };
}

async function scan(opts = {}, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 15, label: 'Verifica degli aggiornamenti disponibili…' });
  const av = await available();
  if (!av.available) return { winget: false, items: [] };
  const r = await runWinget(['upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity'], null, 300000);
  const rows = parseTables(r.out);
  const ignored = new Set(store.settings().ignored.software || []);
  const items = rows.filter((c) => c.length >= 5).map((c) => ({
    name: c[0], id: c[1], version: c[2], available: c[3], source: c[4], ignored: ignored.has(c[1])
  })).filter((x) => x.id && !/\s/.test(x.id));
  return { winget: true, version: av.version, items };
}

// ---------------------------------------------------------------------------
// Progress tracking.
// When its output is redirected, winget prints no progress bar: it only writes
// "Download <url>" and then "downloaded / hash verified". Real progress is measured
// by watching the installer file growing in %TEMP%\WinGet, against the size
// reported by the server for that URL.
// ---------------------------------------------------------------------------
let currentChild = null;
let cancelRequested = false;

async function remoteSize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    let len = Number(r.headers.get('content-length')) || 0;
    if (!len) {
      r = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: ctrl.signal });
      const cr = r.headers.get('content-range');
      if (cr && cr.includes('/')) len = Number(cr.split('/')[1]) || 0;
      try { await r.body.cancel(); } catch (e) {}
    }
    return len;
  } catch (e) { return 0; } finally { clearTimeout(t); }
}

function wingetTempDirs() {
  const dirs = [path.join(os.tmpdir(), 'WinGet')];
  const la = process.env.LOCALAPPDATA;
  if (la) dirs.push(path.join(la, 'Temp', 'WinGet'));
  return [...new Set(dirs.map((d) => d.toLowerCase()))].map((d) => dirs.find((x) => x.toLowerCase() === d));
}

/** Most recently written file in the winget download folders, modified after `since` */
function newestDownload(since) {
  let best = null;
  const visit = (dir, depth) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3 && e.name.toLowerCase() !== 'cache') visit(full, depth + 1); continue; }
      let st;
      try { st = fs.statSync(full); } catch (er) { continue; }
      if (st.mtimeMs >= since - 1500 && (!best || st.mtimeMs > best.mtime)) best = { path: full, size: st.size, mtime: st.mtimeMs };
    }
  };
  for (const d of wingetTempDirs()) visit(d, 0);
  return best;
}

const FRIENDLY_CODES = {
  '-1978335189': 'Nessun aggiornamento applicabile (già aggiornato)',
  '-1978335212': 'Pacchetto non trovato',
  '-1978335215': 'Più pacchetti corrispondono all\'ID',
  '-1978334975': 'Il programma è in uso: chiudilo e riprova',
  '-1978334967': 'Riavvio necessario per completare l\'installazione',
  '-1978334966': 'Riavvio necessario per completare l\'installazione',
  '-1978335226': 'Installazione non riuscita',
  '-1978335221': 'Hash del programma di installazione non valido',
  '-1978335224': 'Download non riuscito'
};

function friendly(code) {
  if (code === 0) return 'Aggiornato';
  const signed = code > 0x7FFFFFFF ? code - 0x100000000 : code;
  return FRIENDLY_CODES[String(signed)] || `Non riuscito (codice 0x${(signed >>> 0).toString(16).toUpperCase()})`;
}

/** Runs one winget command for one package, reporting detailed progress events. */
function runTracked(args, id, emit, timeout = 1800000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(wingetPath(), args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, out: '' }); }
    currentChild = child;
    let out = '';
    let buf = '';
    let dl = null;          // { url, since, total, last, lastT, speed }
    let phase = 'prepare';
    let lastLine = '';
    const killer = setTimeout(() => killTree(child.pid), timeout);
    const tick = () => {
      if (!dl) return;
      const f = newestDownload(dl.since);
      const received = f ? f.size : 0;
      const now = Date.now();
      // average speed since the first byte arrived (file sizes grow in large blocks, so instant speed is jumpy)
      if (received > 0 && !dl.firstT) dl.firstT = dl.lastT || now;
      if (received > dl.last) dl.lastGrowth = now;
      const elapsed = dl.firstT ? ((dl.lastGrowth || now) - dl.firstT) / 1000 : 0;
      dl.speed = elapsed > 0.5 ? received / elapsed : 0;
      dl.last = received; dl.lastT = now;
      const complete = dl.total && received >= dl.total;
      const percent = dl.total ? Math.min(complete ? 100 : 99, Math.round((received / dl.total) * 100)) : null;
      emit({ id, phase: complete ? 'verify' : 'download', received, total: dl.total, speed: complete ? 0 : dl.speed, percent, file: dl.name, part: dl.part });
    };
    const timer = setInterval(tick, 400);
    let parts = 0;
    const onLine = (line) => {
      const url = (line.match(/https?:\/\/\S+/) || [])[0];
      if (url) {
        parts++;
        dl = { url, since: Date.now(), total: 0, last: 0, lastT: 0, speed: 0, name: decodeURIComponent(url.split('/').pop().split('?')[0]), part: parts };
        phase = 'download';
        const cur = dl;
        remoteSize(url).then((n) => { cur.total = n; });
        emit({ id, phase: 'download', received: 0, total: 0, percent: 0, file: dl.name, part: parts });
        return;
      }
      if (/^[\s\-\\|/█▒]+$/.test(line)) return;
      lastLine = line;
      if (phase === 'download' && dl) {
        // download finished (hash verification / file saved)
        if (dl.total) emit({ id, phase: 'download', received: dl.total, total: dl.total, percent: 100, file: dl.name, part: dl.part });
        dl = null;
        phase = 'install';
      }
      if (phase === 'install' || phase === 'prepare') emit({ id, phase, message: line });
    };
    const onData = (d) => {
      const s = d.toString('utf8');
      out += s;
      buf += s;
      const lines = buf.split(/\r\n|\n|\r/);
      buf = lines.pop();
      lines.map((l) => l.trim()).filter(Boolean).forEach(onLine);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const finish = (code) => {
      clearInterval(timer); clearTimeout(killer);
      if (buf.trim()) onLine(buf.trim());
      currentChild = null;
      resolve({ code, out, lastLine });
    };
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

function killTree(pid) {
  if (!pid) return;
  try { spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch (e) {}
}

function cancel() {
  cancelRequested = true;
  if (currentChild) killTree(currentChild.pid);
  return { ok: true };
}

/**
 * Updates the packages one after another.
 * Emits progress events: { id, index, count, phase, percent, received, total, speed, message, overall }
 * phase: queued | prepare | download | install | done | error | cancelled
 */
async function update(opts = {}, ctx = {}) {
  const ids = opts.ids || [];
  const results = [];
  cancelRequested = false;
  const emitFor = (i) => (p) => {
    if (!ctx.progress) return;
    let frac = 0;
    if (p.phase === 'download' || p.phase === 'verify') frac = (p.percent != null ? p.percent / 100 : 0.1) * 0.7;
    else if (p.phase === 'install') frac = 0.8;
    else if (p.phase === 'done' || p.phase === 'error') frac = 1;
    const overall = Math.round(((i + frac) / ids.length) * 100);
    ctx.progress(Object.assign({ index: i, count: ids.length, percent: p.percent, overall, label: `Programma ${i + 1} di ${ids.length}` }, p, { percent: p.percent != null ? p.percent : undefined, overall }));
  };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const emit = emitFor(i);
    if (cancelRequested) { results.push({ id, ok: false, cancelled: true, message: 'Annullato' }); emit({ id, phase: 'cancelled', message: 'Annullato' }); continue; }
    emit({ id, phase: 'prepare', message: 'Ricerca del pacchetto…' });
    const args = ['upgrade', '--id', id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'];
    if (opts.includeUnknown) args.push('--include-unknown');
    const r = await runTracked(args, id, emit);
    const cancelled = cancelRequested;
    const ok = !cancelled && r.code === 0;
    const message = cancelled ? 'Annullato' : friendly(r.code);
    emit({ id, phase: cancelled ? 'cancelled' : ok ? 'done' : 'error', message });
    results.push({ id, ok, cancelled, code: r.code, message, log: r.out.split(/\r\n|\n|\r/).filter((l) => l.trim() && !/^[\s\-\\|/█▒]+$/.test(l)).slice(-8).join('\n') });
  }
  const okN = results.filter((x) => x.ok).length;
  store.addStat('programsUpdated', okN, { type: 'software', items: okN });
  return { results, cancelled: cancelRequested };
}

async function search(opts) {
  const r = await runWinget(['search', opts.query, '--accept-source-agreements', '--disable-interactivity'], null, 120000);
  return parseTables(r.out).filter((c) => c.length >= 3).map((c) => ({ name: c[0], id: c[1], version: c[2], source: c[c.length - 1] }));
}

async function install(opts, ctx = {}) {
  cancelRequested = false;
  const r = await runTracked(['install', '--id', opts.id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], opts.id, (p) => ctx.progress && ctx.progress(p));
  return { ok: r.code === 0, message: friendly(r.code), log: r.out.slice(-1500) };
}

module.exports = { scan, update, cancel, available, search, install, parseTables, runWinget };
