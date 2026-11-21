// Browser cleaner: Chrome, Edge, Brave, Vivaldi, Opera, Opera GX, Chromium, Firefox
const fs = require('fs');
const path = require('path');
const fsu = require('../fsutil');
const ps = require('../ps');
const store = require('../store');

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (e) { sqlite = null; }

const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', exe: 'chrome', root: '%LOCALAPPDATA%\\Google\\Chrome\\User Data' },
  { id: 'edge', name: 'Microsoft Edge', exe: 'msedge', root: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data' },
  { id: 'brave', name: 'Brave', exe: 'brave', root: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data' },
  { id: 'vivaldi', name: 'Vivaldi', exe: 'vivaldi', root: '%LOCALAPPDATA%\\Vivaldi\\User Data' },
  { id: 'chromium', name: 'Chromium', exe: 'chrome', root: '%LOCALAPPDATA%\\Chromium\\User Data' },
  { id: 'opera', name: 'Opera', exe: 'opera', root: '%APPDATA%\\Opera Software\\Opera Stable', single: true, cacheRoot: '%LOCALAPPDATA%\\Opera Software\\Opera Stable' },
  { id: 'operagx', name: 'Opera GX', exe: 'opera', root: '%APPDATA%\\Opera Software\\Opera GX Stable', single: true, cacheRoot: '%LOCALAPPDATA%\\Opera Software\\Opera GX Stable' }
];

const CATS = [
  { id: 'cache', name: 'Cache', desc: 'Immagini e pagine memorizzate per caricare i siti più velocemente.', level: 'basic' },
  { id: 'history', name: 'Cronologia di navigazione', desc: 'Elenco dei siti web visitati.', level: 'full' },
  { id: 'downloads', name: 'Cronologia download', desc: 'Elenco dei file scaricati (i file non vengono eliminati).', level: 'full' },
  { id: 'cookies', name: 'Cookie', desc: 'Piccoli file usati dai siti per ricordarti. Eliminandoli verrai disconnesso dai siti.', level: 'custom' },
  { id: 'sessions', name: 'Sessioni e schede', desc: 'Dati delle schede e delle sessioni precedenti.', level: 'custom' },
  { id: 'formdata', name: 'Dati dei moduli', desc: 'Testo inserito nei moduli web (compilazione automatica). Le password non vengono toccate.', level: 'custom' },
  { id: 'sitedata', name: 'Dati dei siti', desc: 'Local Storage, IndexedDB e dati archiviati dai siti web.', level: 'custom' }
];

function profilesChromium(b) {
  const root = fsu.env(b.root);
  if (!fs.existsSync(root)) return [];
  if (b.single) return [{ name: 'Predefinito', dir: root, cacheDir: b.cacheRoot ? fsu.env(b.cacheRoot) : root }];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === 'Default' || /^Profile \d+$/.test(e.name) || e.name === 'Guest Profile') {
      const dir = path.join(root, e.name);
      let label = e.name;
      try {
        const ls = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'));
        if (ls.profile && ls.profile.info_cache && ls.profile.info_cache[e.name]) label = ls.profile.info_cache[e.name].name || label;
      } catch (err) {}
      out.push({ name: label, dir, cacheDir: dir });
    }
  }
  return out;
}

function profilesFirefox() {
  const ini = fsu.env('%APPDATA%\\Mozilla\\Firefox\\profiles.ini');
  if (!fs.existsSync(ini)) return [];
  const txt = fs.readFileSync(ini, 'utf8');
  const out = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    if (/^\[Profile/.test(line)) { cur = {}; out.push(cur); continue; }
    if (/^\[/.test(line)) { cur = null; continue; }
    const m = line.match(/^(\w+)=(.*)$/);
    if (cur && m) cur[m[1]] = m[2];
  }
  return out.filter((p) => p.Path).map((p) => {
    const rel = p.IsRelative === '1';
    const dir = rel ? path.join(fsu.env('%APPDATA%\\Mozilla\\Firefox'), p.Path.replace(/\//g, '\\')) : p.Path;
    const cacheDir = rel ? path.join(fsu.env('%LOCALAPPDATA%\\Mozilla\\Firefox'), p.Path.replace(/\//g, '\\')) : dir;
    return { name: p.Name || p.Path, dir, cacheDir };
  }).filter((p) => fs.existsSync(p.dir));
}

function filesFor(kind, cat, prof) {
  // returns { dirs: [], files: [] }
  const j = (...a) => path.join(...a);
  if (kind === 'chromium') {
    switch (cat) {
      case 'cache': return { dirs: [j(prof.cacheDir, 'Cache'), j(prof.cacheDir, 'Code Cache'), j(prof.dir, 'GPUCache'), j(prof.dir, 'Service Worker', 'CacheStorage'), j(prof.dir, 'Service Worker', 'ScriptCache'), j(prof.dir, 'DawnCache'), j(prof.dir, 'DawnGraphiteCache'), j(prof.dir, 'DawnWebGPUCache'), j(prof.dir, '..', 'ShaderCache'), j(prof.dir, '..', 'GrShaderCache'), j(prof.dir, '..', 'GraphiteDawnCache')], files: [] };
      case 'history': return { dirs: [], files: ['Visited Links', 'Top Sites', 'Top Sites-journal', 'Shortcuts', 'Shortcuts-journal', 'Network Action Predictor', 'Network Action Predictor-journal', 'History Provider Cache'].map((f) => j(prof.dir, f)), sql: { file: j(prof.dir, 'History'), stmts: ['DELETE FROM visits', 'DELETE FROM urls', 'DELETE FROM keyword_search_terms', 'DELETE FROM segments', 'DELETE FROM segment_usage', 'DELETE FROM visit_source', 'DELETE FROM content_annotations', 'DELETE FROM context_annotations', 'DELETE FROM clusters', 'DELETE FROM clusters_and_visits'], count: 'SELECT COUNT(*) AS c FROM urls' } };
      case 'downloads': return { dirs: [], files: [], sql: { file: j(prof.dir, 'History'), stmts: ['DELETE FROM downloads', 'DELETE FROM downloads_url_chains', 'DELETE FROM downloads_slices'], count: 'SELECT COUNT(*) AS c FROM downloads' } };
      case 'cookies': return { dirs: [], files: [j(prof.dir, 'Network', 'Cookies'), j(prof.dir, 'Network', 'Cookies-journal'), j(prof.dir, 'Cookies'), j(prof.dir, 'Cookies-journal')] };
      case 'sessions': return { dirs: [j(prof.dir, 'Sessions')], files: ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'].map((f) => j(prof.dir, f)) };
      case 'formdata': return { dirs: [], files: [], sql: { file: j(prof.dir, 'Web Data'), stmts: ['DELETE FROM autofill', 'DELETE FROM autofill_profiles', 'DELETE FROM autofill_profile_names', 'DELETE FROM autofill_profile_emails', 'DELETE FROM autofill_profile_phones', 'DELETE FROM autofill_profile_addresses'], count: 'SELECT COUNT(*) AS c FROM autofill' } };
      case 'sitedata': return { dirs: [j(prof.dir, 'Local Storage'), j(prof.dir, 'IndexedDB'), j(prof.dir, 'Session Storage'), j(prof.dir, 'File System'), j(prof.dir, 'databases')], files: [] };
    }
  } else {
    switch (cat) {
      case 'cache': return { dirs: [j(prof.cacheDir, 'cache2'), j(prof.cacheDir, 'startupCache'), j(prof.cacheDir, 'thumbnails'), j(prof.dir, 'shader-cache')], files: [] };
      case 'history': return { dirs: [], files: [], sql: { file: j(prof.dir, 'places.sqlite'), stmts: ['DELETE FROM moz_historyvisits', 'DELETE FROM moz_inputhistory', "UPDATE moz_places SET visit_count = 0, last_visit_date = NULL, frecency = 0", 'DELETE FROM moz_places WHERE id NOT IN (SELECT fk FROM moz_bookmarks WHERE fk IS NOT NULL) AND id NOT IN (SELECT place_id FROM moz_annos)'], count: 'SELECT COUNT(*) AS c FROM moz_historyvisits' } };
      case 'downloads': return { dirs: [], files: [], sql: { file: j(prof.dir, 'places.sqlite'), stmts: ["DELETE FROM moz_annos WHERE anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name LIKE 'downloads/%')"], count: "SELECT COUNT(*) AS c FROM moz_annos WHERE anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name = 'downloads/destinationFileURI')" } };
      case 'cookies': return { dirs: [], files: [j(prof.dir, 'cookies.sqlite'), j(prof.dir, 'cookies.sqlite-wal'), j(prof.dir, 'cookies.sqlite-shm')] };
      case 'sessions': return { dirs: [j(prof.dir, 'sessionstore-backups')], files: [j(prof.dir, 'sessionstore.jsonlz4')] };
      case 'formdata': return { dirs: [], files: [j(prof.dir, 'formhistory.sqlite')] };
      case 'sitedata': return { dirs: [j(prof.dir, 'storage', 'default'), j(prof.dir, 'storage', 'temporary')], files: [j(prof.dir, 'webappsstore.sqlite')] };
    }
  }
  return { dirs: [], files: [] };
}

function sqlCount(file, q) {
  if (!sqlite || !fs.existsSync(file)) return 0;
  try {
    const db = new sqlite.DatabaseSync(file, { readOnly: true });
    try { const r = db.prepare(q).get(); return r ? Number(r.c) : 0; } finally { db.close(); }
  } catch (e) {
    // database locked (browser open) -> copy and count
    try {
      const tmp = path.join(require('os').tmpdir(), 'nt_' + Date.now() + '.db');
      fs.copyFileSync(file, tmp);
      const db = new sqlite.DatabaseSync(tmp, { readOnly: true });
      let c = 0; try { c = Number(db.prepare(q).get().c); } finally { db.close(); fs.unlinkSync(tmp); }
      return c;
    } catch (e2) { return 0; }
  }
}

function sqlRun(file, stmts) {
  if (!sqlite || !fs.existsSync(file)) return false;
  const db = new sqlite.DatabaseSync(file);
  try {
    for (const s of stmts) { try { db.exec(s); } catch (e) { /* table may not exist in this version */ } }
    try { db.exec('VACUUM'); } catch (e) {}
    return true;
  } finally { db.close(); }
}

async function runningBrowsers() {
  const r = await ps.exec('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const names = new Set(r.stdout.split(/\r?\n/).map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()));
  return { chrome: names.has('chrome.exe'), msedge: names.has('msedge.exe'), brave: names.has('brave.exe'), vivaldi: names.has('vivaldi.exe'), opera: names.has('opera.exe'), firefox: names.has('firefox.exe') };
}

function browsersList() {
  const out = [];
  for (const b of CHROMIUM) {
    const profiles = profilesChromium(b);
    if (profiles.length) out.push({ id: b.id, name: b.name, exe: b.exe, kind: 'chromium', profiles });
  }
  const ff = profilesFirefox();
  if (ff.length) out.push({ id: 'firefox', name: 'Mozilla Firefox', exe: 'firefox', kind: 'firefox', profiles: ff });
  return out;
}

function selectedCats(level) {
  const s = store.settings();
  level = level || s.browserLevel || 'basic';
  if (level === 'custom' && Array.isArray(s.browserCategories)) return s.browserCategories;
  let cats = CATS.filter((c) => c.level === 'basic' || (level === 'full' && c.level === 'full')).map((c) => c.id);
  if (!s.keepCookies && level === 'full') cats.push('cookies');
  return cats;
}

let last = null;

async function scan(opts = {}, ctx = {}) {
  const sel = opts.categories || selectedCats(opts.level);
  const ignored = new Set(store.settings().ignored.browser || []);
  const running = await runningBrowsers();
  const browsers = browsersList();
  const result = [];
  let n = 0;
  for (const b of browsers) {
    n++;
    if (ctx.progress) ctx.progress({ percent: Math.round((n / Math.max(1, browsers.length)) * 100), label: b.name });
    const br = { id: b.id, name: b.name, running: !!running[b.exe], ignored: ignored.has(b.id), categories: [], size: 0, count: 0 };
    for (const c of CATS) {
      const entry = { id: c.id, name: c.name, desc: c.desc, selected: sel.includes(c.id), size: 0, count: 0, files: [], sql: [] };
      for (const prof of b.profiles) {
        const t = filesFor(b.kind, c.id, prof);
        for (const d of t.dirs) {
          const r = await fsu.walk(d, {});
          entry.size += r.size; entry.count += r.count; entry.files.push(...r.files);
          entry.dirs = (entry.dirs || []).concat(d);
        }
        for (const f of t.files) {
          try { const st = fs.statSync(f); entry.size += st.size; entry.count++; entry.files.push({ path: f, size: st.size }); } catch (e) {}
        }
        if (t.sql) {
          const cnt = sqlCount(t.sql.file, t.sql.count);
          if (cnt) { entry.count += cnt; entry.sql.push(t.sql); }
        }
      }
      if (entry.selected) { br.size += entry.size; br.count += entry.count; }
      br.categories.push(entry);
    }
    result.push(br);
  }
  last = result;
  return summary(result);
}

function summary(result) {
  const browsers = result.map((b) => ({ id: b.id, name: b.name, running: b.running, ignored: b.ignored, size: b.size, count: b.count,
    categories: b.categories.map((c) => ({ id: c.id, name: c.name, desc: c.desc, selected: c.selected, size: c.size, count: c.count })) }));
  const act = browsers.filter((b) => !b.ignored);
  return { browsers, totalSize: act.reduce((a, b) => a + b.size, 0), totalCount: act.reduce((a, b) => a + b.count, 0), sqlite: !!sqlite, categories: CATS };
}

async function closeBrowsers(ids) {
  const map = { chrome: 'chrome.exe', edge: 'msedge.exe', brave: 'brave.exe', vivaldi: 'vivaldi.exe', chromium: 'chrome.exe', opera: 'opera.exe', operagx: 'opera.exe', firefox: 'firefox.exe' };
  for (const id of ids) if (map[id]) await ps.exec('taskkill.exe', ['/IM', map[id], '/F', '/T']);
  await new Promise((r) => setTimeout(r, 1500));
  return { ok: true };
}

/** opts: { selection: { browserId: [catIds] } } */
async function clean(opts = {}, ctx = {}) {
  if (!last) await scan(opts, {});
  const ignored = new Set(store.settings().ignored.browser || []);
  if (opts.closeRunning) await closeBrowsers(last.filter((b) => b.running).map((b) => b.id));
  let freed = 0, items = 0, skipped = [];
  for (const b of last) {
    if (ignored.has(b.id)) continue;
    const cats = opts.selection && opts.selection[b.id] ? opts.selection[b.id] : b.categories.filter((c) => c.selected).map((c) => c.id);
    if (!cats.length) continue;
    if (b.running && !opts.closeRunning) { skipped.push(b.name); continue; }
    if (ctx.progress) ctx.progress({ label: 'Pulizia ' + b.name });
    for (const c of b.categories) {
      if (!cats.includes(c.id)) continue;
      const r = await fsu.deleteFiles(c.files);
      freed += r.freed; items += r.deleted;
      for (const d of c.dirs || []) await fsu.removeEmptyDirs(d, true);
      for (const s of c.sql) { try { sqlRun(s.file, s.stmts); items += 0; } catch (e) {} }
      items += c.sql.length ? c.count - c.files.length : 0;
    }
  }
  last = null;
  store.addStat('spaceFreed', freed);
  store.addStat('browserItems', items, { type: 'browser', items, bytes: freed });
  return { freed, items, skipped };
}

module.exports = { scan, clean, closeBrowsers, browsersList: () => browsersList().map((b) => ({ id: b.id, name: b.name, profiles: b.profiles.length })), categories: () => CATS };
