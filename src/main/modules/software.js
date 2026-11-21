// Software Updater based on Windows Package Manager (winget)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
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

async function update(opts = {}, ctx = {}) {
  const ids = opts.ids || [];
  const results = [];
  let i = 0;
  for (const id of ids) {
    i++;
    if (ctx.progress) ctx.progress({ percent: Math.round(((i - 1) / ids.length) * 100), label: `Aggiornamento di ${id} (${i}/${ids.length})…`, id });
    const args = ['upgrade', '--id', id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'];
    if (opts.includeUnknown) args.push('--include-unknown');
    const r = await runWinget(args, (line) => {
      const m = line.match(/(\d{1,3})\s?%/);
      if (m && ctx.progress) ctx.progress({ percent: Math.round(((i - 1 + parseInt(m[1], 10) / 100) / ids.length) * 100), label: `Aggiornamento di ${id}: ${m[1]}%`, id });
    }, 1800000);
    const ok = r.code === 0;
    results.push({ id, ok, code: r.code, log: r.out.split(/\r?\n/).filter((l) => l.trim() && !/^[\s\-\\|/█▒]+$/.test(l)).slice(-6).join('\n') });
  }
  const okN = results.filter((x) => x.ok).length;
  store.addStat('programsUpdated', okN, { type: 'software', items: okN });
  return { results };
}

async function search(opts) {
  const r = await runWinget(['search', opts.query, '--accept-source-agreements', '--disable-interactivity'], null, 120000);
  return parseTables(r.out).filter((c) => c.length >= 3).map((c) => ({ name: c[0], id: c[1], version: c[2], source: c[c.length - 1] }));
}

async function install(opts, ctx = {}) {
  const r = await runWinget(['install', '--id', opts.id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], (line) => {
    const m = line.match(/(\d{1,3})\s?%/); if (m && ctx.progress) ctx.progress({ percent: parseInt(m[1], 10), label: 'Installazione di ' + opts.id });
  }, 1800000);
  return { ok: r.code === 0, log: r.out.slice(-1500) };
}

module.exports = { scan, update, available, search, install, parseTables, runWinget };
