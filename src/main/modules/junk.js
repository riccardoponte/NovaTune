// System junk / Disk cleanup (Windows + application junk)
const fs = require('fs');
const path = require('path');
const fsu = require('../fsutil');
const ps = require('../ps');
const store = require('../store');

const H = 3600 * 1000;

// level: basic = safe, always selected ; full = also selected in full cleaning ; custom = only if chosen
const CATEGORIES = [
  { id: 'winTemp', group: 'windows', level: 'basic', name: 'File temporanei di Windows', desc: 'File creati da Windows e dai programmi per un uso temporaneo e non più necessari.',
    sources: [{ dir: '%TEMP%', minAgeH: 2 }, { dir: '%SystemRoot%\\Temp', minAgeH: 2 }, { dir: '%SystemRoot%\\ServiceProfiles\\LocalService\\AppData\\Local\\Temp', minAgeH: 2 }] },
  { id: 'winCache', group: 'windows', level: 'basic', name: 'Cache di Windows', desc: 'Cache delle miniature, cache Internet di sistema, cache shader DirectX e cache Ottimizzazione recapito.',
    sources: [{ dir: '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer', pattern: 'thumbcache_*.db', recursive: false },
      { dir: '%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache' }, { dir: '%LOCALAPPDATA%\\D3DSCache' },
      { dir: '%SystemRoot%\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache' },
      { dir: '%SystemRoot%\\SoftwareDistribution\\DeliveryOptimization' }] },
  { id: 'winLogs', group: 'windows', level: 'basic', name: 'File di registro (log) di Windows', desc: 'Registri delle attività di Windows, dell\'installazione e degli aggiornamenti.',
    sources: [{ dir: '%SystemRoot%\\Logs', pattern: '*.log', minAgeH: 24 }, { dir: '%SystemRoot%\\Logs', pattern: '*.etl', minAgeH: 24 },
      { dir: '%SystemRoot%\\Panther', pattern: '*.log', minAgeH: 24 }, { dir: '%SystemRoot%', pattern: '*.log', recursive: false, minAgeH: 24 },
      { dir: '%SystemRoot%\\System32\\LogFiles\\setupcln', minAgeH: 24 }, { dir: '%SystemRoot%\\debug', pattern: '*.log', minAgeH: 24 },
      { dir: '%LOCALAPPDATA%\\Microsoft\\Windows\\WebCache', pattern: '*.log', recursive: false, minAgeH: 24 }] },
  { id: 'winDump', group: 'windows', level: 'basic', name: 'Dump di memoria e segnalazioni errori', desc: 'File di dump creati in seguito ad arresti anomali e report di Segnalazione errori Windows.',
    sources: [{ dir: '%SystemRoot%\\Minidump' }, { dir: '%SystemRoot%', pattern: 'MEMORY.DMP', recursive: false }, { dir: '%SystemRoot%\\LiveKernelReports', pattern: '*.dmp' },
      { dir: '%LOCALAPPDATA%\\CrashDumps' }, { dir: '%ProgramData%\\Microsoft\\Windows\\WER\\ReportArchive' }, { dir: '%ProgramData%\\Microsoft\\Windows\\WER\\ReportQueue' },
      { dir: '%ProgramData%\\Microsoft\\Windows\\WER\\Temp' }, { dir: '%LOCALAPPDATA%\\Microsoft\\Windows\\WER' }] },
  { id: 'winDownload', group: 'windows', level: 'full', name: 'File scaricati da Windows Update', desc: 'Pacchetti di aggiornamento già installati e conservati nella cache di Windows Update.',
    sources: [{ dir: '%SystemRoot%\\SoftwareDistribution\\Download', minAgeH: 24 }] },
  { id: 'winSetup', group: 'windows', level: 'full', name: 'File di installazione di Windows', desc: 'File temporanei di installazione/aggiornamento di Windows ($Windows.~BT, $Windows.~WS, ESD) e installazione precedente (Windows.old).',
    sources: [{ dir: '%SystemDrive%\\$Windows.~BT' }, { dir: '%SystemDrive%\\$Windows.~WS' }, { dir: '%SystemDrive%\\ESD' }, { dir: '%SystemDrive%\\$GetCurrent' }, { dir: '%SystemDrive%\\Windows.old' }],
    special: 'takeown' },
  { id: 'winHistory', group: 'windows', level: 'full', name: 'Cronologia di Windows', desc: 'Elenco dei documenti aperti di recente e delle Jump List.',
    sources: [{ dir: '%APPDATA%\\Microsoft\\Windows\\Recent', pattern: '*.lnk', recursive: false },
      { dir: '%APPDATA%\\Microsoft\\Windows\\Recent\\AutomaticDestinations' }, { dir: '%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations' }] },
  { id: 'winBackup', group: 'windows', level: 'full', name: 'File di backup di Windows', desc: 'Frammenti di file recuperati da Controllo disco (found.000) e vecchi backup di ripristino di Windows.',
    sources: [{ dir: '%SystemDrive%\\found.*', wildcard: true }, { dir: '%SystemRoot%\\System32\\config\\RegBack', minAgeH: 720 }] },
  { id: 'winRecycleBin', group: 'windows', level: 'full', name: 'Cestino', desc: 'File eliminati e ancora presenti nel Cestino.', special: 'recycle' },
  { id: 'winRestorePoints', group: 'windows', level: 'custom', name: 'Punti di ripristino precedenti', desc: 'Copie shadow e punti di ripristino meno recenti. Viene conservato il punto di ripristino più recente.', special: 'restore' },

  { id: 'appCache', group: 'apps', level: 'basic', name: 'Cache delle applicazioni', desc: 'Cache di app come Discord, Spotify, Teams, Slack, Steam, VS Code, driver grafici e app di Microsoft Store.',
    sources: [
      ...['discord', 'Slack', 'Code', 'Microsoft\\Teams', 'Zoom\\data', 'WhatsApp', 'Signal', 'Telegram Desktop', 'Notion', 'Figma', 'obsidian', 'Postman'].flatMap((a) =>
        ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'CachedData', 'Service Worker\\CacheStorage'].map((c) => ({ dir: `%APPDATA%\\${a}\\${c}` }))),
      { dir: '%LOCALAPPDATA%\\Spotify\\Data' }, { dir: '%LOCALAPPDATA%\\Spotify\\Browser\\Cache' },
      { dir: '%LOCALAPPDATA%\\Steam\\htmlcache' }, { dir: '%LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\webcache*', wildcard: true },
      { dir: '%LOCALAPPDATA%\\NVIDIA\\DXCache' }, { dir: '%LOCALAPPDATA%\\NVIDIA\\GLCache' }, { dir: '%ProgramData%\\NVIDIA Corporation\\NV_Cache' },
      { dir: '%LOCALAPPDATA%\\AMD\\DxCache' }, { dir: '%LOCALAPPDATA%\\AMD\\DxcCache' }, { dir: '%LOCALAPPDATA%\\AMD\\GLCache' }, { dir: '%LOCALAPPDATA%\\AMD\\VkCache' },
      { dir: '%LOCALAPPDATA%\\Intel\\ShaderCache' }, { dir: '%USERPROFILE%\\AppData\\LocalLow\\Intel\\ShaderCache' },
      { dir: '%APPDATA%\\Adobe\\Common\\Media Cache Files' }, { dir: '%APPDATA%\\Adobe\\Common\\Media Cache' },
      { dir: '%USERPROFILE%\\AppData\\LocalLow\\Sun\\Java\\Deployment\\cache' },
      { dir: '%LOCALAPPDATA%\\Packages\\*\\AC\\INetCache', wildcard: true }, { dir: '%LOCALAPPDATA%\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\Default\\Cache', wildcard: true },
      { dir: '%LOCALAPPDATA%\\pip\\cache' }, { dir: '%LOCALAPPDATA%\\Microsoft\\Office\\16.0\\OfficeFileCache' }] },
  { id: 'appTemp', group: 'apps', level: 'basic', name: 'File temporanei delle applicazioni', desc: 'File temporanei lasciati dalle app di Microsoft Store e da altri programmi.',
    sources: [{ dir: '%LOCALAPPDATA%\\Packages\\*\\AC\\Temp', wildcard: true, minAgeH: 2 }, { dir: '%LOCALAPPDATA%\\Packages\\*\\TempState', wildcard: true, minAgeH: 2 },
      { dir: '%LOCALAPPDATA%\\Microsoft\\Office\\UnsavedFiles', minAgeH: 720 }] },
  { id: 'appLogs', group: 'apps', level: 'full', name: 'File di registro delle applicazioni', desc: 'Log meno recenti di 7 giorni creati da applicazioni di terze parti.', special: 'applogs' },
  { id: 'appDump', group: 'apps', level: 'basic', name: 'Dump di arresto anomalo delle applicazioni', desc: 'Report di arresti anomali (Crashpad, CrashReports) creati dalle applicazioni.', special: 'appdumps' },
  { id: 'appSetup', group: 'apps', level: 'full', name: 'File di installazione delle applicazioni', desc: 'Pacchetti di installazione estratti dai driver grafici e da altri programmi dopo l\'installazione.',
    sources: [{ dir: '%SystemDrive%\\NVIDIA' }, { dir: '%SystemDrive%\\AMD' }, { dir: '%SystemDrive%\\Intel\\Logs' }, { dir: '%ProgramData%\\NVIDIA Corporation\\Downloader' },
      { dir: '%ProgramData%\\NVIDIA Corporation\\NetService', pattern: '*.exe' }, { dir: '%LOCALAPPDATA%\\Downloaded Installations' }] },
  { id: 'appDownload', group: 'apps', level: 'full', name: 'File scaricati dalle applicazioni', desc: 'Programmi di aggiornamento già usati, scaricati da Google, Microsoft Edge, Adobe e altri.',
    sources: [{ dir: '%ProgramFiles(x86)%\\Google\\Update\\Download' }, { dir: '%ProgramFiles(x86)%\\Microsoft\\EdgeUpdate\\Download' },
      { dir: '%ProgramData%\\Adobe\\ARM' , pattern: '*.msi' }, { dir: '%ProgramData%\\Package Cache\\.unverified' }, { dir: '%LOCALAPPDATA%\\Microsoft\\OneDrive\\Update' , pattern: '*.exe' },
      { dir: '%LOCALAPPDATA%\\SquirrelTemp' }] },
  { id: 'appHistory', group: 'apps', level: 'custom', name: 'Cronologia delle applicazioni', desc: 'Elenchi dei file recenti di Office e di altre applicazioni.',
    sources: [{ dir: '%APPDATA%\\Microsoft\\Office\\Recent', pattern: '*.lnk' }, { dir: '%APPDATA%\\vlc', pattern: 'ml.xspf' }] }
];

let lastScan = null;

function selectedIds(level) {
  const s = store.settings();
  level = level || s.junkLevel || 'full';
  if (level === 'custom' && Array.isArray(s.junkCategories)) return s.junkCategories;
  return CATEGORIES.filter((c) => c.level === 'basic' || (level === 'full' && c.level === 'full')).map((c) => c.id);
}

async function scanSource(src) {
  const dirs = src.wildcard || src.dir.includes('*') ? await fsu.expandWildcardDirs(src.dir) : [fsu.env(src.dir)];
  const res = { files: [], size: 0, count: 0, roots: [] };
  for (const d of dirs) {
    if (!(await fsu.exists(d))) continue;
    res.roots.push(d);
    await fsu.walk(d, { pattern: src.pattern, recursive: src.recursive !== false, minAgeMs: (src.minAgeH || 0) * H }, 0, res);
  }
  return res;
}

async function scanAppFolders(nameRe, opts) {
  // looks for folders named e.g. "logs" at depth <= 3 under %APPDATA% / %LOCALAPPDATA% / %ProgramData%
  const roots = ['%APPDATA%', '%LOCALAPPDATA%', '%ProgramData%'].map(fsu.env);
  const res = { files: [], size: 0, count: 0, roots: [] };
  const skip = /^(Microsoft|Packages|Temp|Google|Mozilla|BraveSoftware|Opera Software|Vivaldi|NovaTune PC Suite|novatune-pc-suite)$/i;
  async function rec(dir, depth) {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (depth === 0 && skip.test(e.name)) continue;
      if (nameRe.test(e.name)) {
        res.roots.push(full);
        await fsu.walk(full, { pattern: opts.pattern, minAgeMs: opts.minAgeMs || 0 }, 0, res);
      } else if (depth < 3) await rec(full, depth + 1);
    }
  }
  for (const r of roots) await rec(r, 0);
  return res;
}

async function recycleBinSize() {
  const r = await ps.json(`
$sh = New-Object -ComObject Shell.Application
$rb = $sh.Namespace(10)
$size = [int64]0; $count = 0
foreach ($i in $rb.Items()) { $count++; try { $size += [int64]$i.ExtendedProperty('Size') } catch {} }
Emit-Result @{ size = $size; count = $count }`);
  return r;
}

async function shadowInfo() {
  return ps.json(`
$sc = @(Get-CimInstance Win32_ShadowCopy | Sort-Object InstallDate)
$used = [int64]0
Get-CimInstance Win32_ShadowStorage | ForEach-Object { $used += [int64]$_.UsedSpace }
$keepLatest = if ($sc.Count -gt 0) { $sc[-1] } else { $null }
$older = if ($sc.Count -gt 1) { $sc.Count - 1 } else { 0 }
$est = if ($sc.Count -gt 0) { [int64]($used * $older / $sc.Count) } else { 0 }
Emit-Result @{ count = $sc.Count; older = $older; size = $est }`);
}

async function scan(opts = {}, ctx = {}) {
  const ids = opts.categories || selectedIds(opts.level);
  const ignored = new Set(store.settings().ignored.junk || []);
  const results = [];
  let i = 0;
  for (const cat of CATEGORIES) {
    i++;
    if (ctx.progress) ctx.progress({ percent: Math.round((i / CATEGORIES.length) * 100), label: cat.name });
    const out = { id: cat.id, name: cat.name, desc: cat.desc, group: cat.group, level: cat.level, selected: ids.includes(cat.id) && !ignored.has(cat.id), size: 0, count: 0, files: [] };
    try {
      if (cat.special === 'recycle') {
        const r = await recycleBinSize(); out.size = r.size; out.count = r.count;
      } else if (cat.special === 'restore') {
        const r = await shadowInfo(); out.size = r.size; out.count = r.older;
      } else if (cat.special === 'applogs') {
        const r = await scanAppFolders(/^logs?$/i, { minAgeMs: 7 * 24 * H });
        Object.assign(out, { size: r.size, count: r.count, files: r.files });
      } else if (cat.special === 'appdumps') {
        const r = await scanAppFolders(/^(Crashpad|CrashReports|crashes|Crash Reports|CrashDumps)$/i, {});
        Object.assign(out, { size: r.size, count: r.count, files: r.files });
      } else {
        for (const s of cat.sources) {
          const r = await scanSource(s);
          out.size += r.size; out.count += r.count; out.files.push(...r.files);
          if (cat.special === 'takeown') { out.roots = (out.roots || []).concat(r.roots); }
        }
      }
    } catch (e) { out.error = String(e.message || e); }
    results.push(out);
  }
  lastScan = { date: Date.now(), results };
  return summary(results);
}

function summary(results) {
  const list = results.map((r) => ({
    id: r.id, name: r.name, desc: r.desc, group: r.group, level: r.level, selected: r.selected, size: r.size, count: r.count, error: r.error,
    top: (r.files || []).slice().sort((a, b) => b.size - a.size).slice(0, 150).map((f) => ({ path: f.path, size: f.size }))
  }));
  const sel = list.filter((r) => r.selected);
  return { categories: list, totalSize: sel.reduce((a, r) => a + r.size, 0), totalCount: sel.reduce((a, r) => a + r.count, 0) };
}

async function clean(opts = {}, ctx = {}) {
  if (!lastScan || Date.now() - lastScan.date > 30 * 60 * 1000) await scan(opts, {});
  const ids = opts.categories || lastScan.results.filter((r) => r.selected).map((r) => r.id);
  let freed = 0, deleted = 0, failed = 0;
  let idx = 0;
  for (const r of lastScan.results) {
    if (!ids.includes(r.id)) continue;
    idx++;
    const cat = CATEGORIES.find((c) => c.id === r.id);
    if (ctx.progress) ctx.progress({ percent: Math.round((idx / ids.length) * 100), label: 'Pulizia: ' + cat.name });
    if (cat.special === 'recycle') {
      await ps.run(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Emit-Result @{ok=$true}`);
      freed += r.size; deleted += r.count;
    } else if (cat.special === 'restore') {
      await ps.run(`$sc = @(Get-CimInstance Win32_ShadowCopy | Sort-Object InstallDate)
if ($sc.Count -gt 1) { $sc[0..($sc.Count-2)] | ForEach-Object { Remove-CimInstance -InputObject $_ } }
Emit-Result @{ok=$true}`, { timeout: 600000 });
      freed += r.size; deleted += r.count;
    } else if (cat.special === 'takeown') {
      const res = await fsu.deleteFiles(r.files);
      freed += res.freed; deleted += res.deleted;
      // stubborn system folders (Windows.old etc.): take ownership then remove
      const roots = (r.roots || []);
      if (res.failed && roots.length) {
        await ps.run(`foreach ($p in $A) { if (Test-Path -LiteralPath $p) {
  & takeown.exe /F $p /R /A /D Y | Out-Null
  & icacls.exe $p /grant '*S-1-5-32-544:F' /T /C /Q | Out-Null
  & cmd.exe /c rd /s /q "$p" | Out-Null } }
Emit-Result @{ok=$true}`, { args: roots, timeout: 1800000 });
        freed += r.size - res.freed; deleted += res.failed;
      } else failed += res.failed;
      for (const root of roots) await fsu.removeEmptyDirs(root, false);
    } else {
      const res = await fsu.deleteFiles(r.files);
      freed += res.freed; deleted += res.deleted; failed += res.failed;
      const roots = new Set();
      for (const s of cat.sources || []) {
        if (s.recursive === false) continue;
        const ds = s.wildcard || s.dir.includes('*') ? await fsu.expandWildcardDirs(s.dir) : [fsu.env(s.dir)];
        ds.forEach((d) => roots.add(d));
      }
      for (const root of roots) await fsu.removeEmptyDirs(root, true);
    }
  }
  lastScan = null;
  store.addStat('spaceFreed', freed);
  store.addStat('junkItems', deleted, { type: 'junk', items: deleted, bytes: freed });
  return { freed, deleted, failed };
}

function categories() { return CATEGORIES.map(({ id, name, desc, group, level }) => ({ id, name, desc, group, level })); }

module.exports = { scan, clean, categories };
