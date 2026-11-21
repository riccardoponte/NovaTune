// Advanced Uninstaller: Win32 programs, Microsoft Store apps, browser extensions,
// leftover scan (files/registry/services/tasks), forced uninstall, batch uninstall.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');
const fsu = require('../fsutil');

let electronShell = null;
try { electronShell = require('electron').shell; } catch (e) {}

const LIST = `
$roots = @(
  @{ k = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; arch = 'x64' },
  @{ k = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; arch = 'x86' },
  @{ k = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; arch = 'user' }
)
$pf = @{}
Get-ChildItem "$env:windir\\Prefetch" -Filter *.pf -ErrorAction SilentlyContinue | ForEach-Object { $n = ($_.Name -replace '-[0-9A-F]{8}\\.pf$','').ToLower(); if (-not $pf.ContainsKey($n) -or $pf[$n] -lt $_.LastWriteTime) { $pf[$n] = $_.LastWriteTime } }
$out = New-Object System.Collections.ArrayList
foreach ($r in $roots) {
  $base = Get-Item -LiteralPath ('Registry::' + $r.k) -ErrorAction SilentlyContinue
  if (-not $base) { continue }
  foreach ($sk in $base.GetSubKeyNames()) {
    $k = $base.OpenSubKey($sk)
    if (-not $k) { continue }
    $name = $k.GetValue('DisplayName')
    if (-not $name) { continue }
    if ($k.GetValue('SystemComponent') -eq 1) { continue }
    if ($k.GetValue('ParentKeyName')) { continue }
    $rt = [string]$k.GetValue('ReleaseType'); if ($rt -match 'Update|Hotfix|Security') { continue }
    $us = [string]$k.GetValue('UninstallString'); $qus = [string]$k.GetValue('QuietUninstallString')
    if (-not $us -and -not $qus) { continue }
    $loc = [string]$k.GetValue('InstallLocation'); $icon = [string]$k.GetValue('DisplayIcon')
    $size = [int64]($k.GetValue('EstimatedSize')) * 1024
    $lastUsed = $null
    if ($loc -and (Test-Path -LiteralPath $loc)) {
      Get-ChildItem -LiteralPath $loc -Filter *.exe -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { $n = $_.Name.ToLower(); if ($pf.ContainsKey($n)) { if (-not $lastUsed -or $pf[$n] -gt $lastUsed) { $lastUsed = $pf[$n] } } }
    }
    [void]$out.Add(@{
      key = $r.k + '\\' + $sk; keyName = $sk; arch = $r.arch; name = [string]$name; version = [string]$k.GetValue('DisplayVersion'); publisher = [string]$k.GetValue('Publisher')
      installDate = [string]$k.GetValue('InstallDate'); size = $size; location = $loc; icon = $icon; uninstall = $us; quiet = $qus
      msi = ([int]$k.GetValue('WindowsInstaller') -eq 1) -or ($us -match 'msiexec'); noRemove = ([int]$k.GetValue('NoRemove') -eq 1); url = [string]$k.GetValue('URLInfoAbout')
      lastUsed = $(if ($lastUsed) { $lastUsed.ToString('o') } else { $null }); keyDate = $null })
  }
}
Emit-Result @($out)
`;

function parseInstallDate(s) {
  if (s && /^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

let cache = null;

async function list(opts = {}, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 20, label: 'Lettura dei programmi installati…' });
  const r = ps.arr(await ps.json(LIST, { timeout: 180000 }));
  // de-duplicate (same name+version in multiple hives)
  const seen = new Map();
  for (const p of r) {
    const k = (p.name + '|' + p.version).toLowerCase();
    if (!seen.has(k)) seen.set(k, p);
  }
  const progs = [...seen.values()].map((p) => Object.assign(p, { installDate: parseInstallDate(p.installDate), id: p.key }));
  // compute missing sizes for programs with a location (bounded)
  for (const p of progs) {
    if (!p.size && p.location && fs.existsSync(p.location) && !/^[A-Z]:\\?$/i.test(p.location)) {
      try { const s = await fsu.dirSize(p.location); p.size = s.size; } catch (e) {}
    }
  }
  progs.sort((a, b) => a.name.localeCompare(b.name));
  cache = progs;
  return progs;
}

async function icons(opts) {
  const { app } = require('electron');
  const out = {};
  for (const p of opts.items) {
    let file = (p.icon || '').replace(/"/g, '').replace(/,\s*-?\d+$/, '').trim();
    if (!file || !fs.existsSync(file)) {
      if (p.location && fs.existsSync(p.location)) {
        try { const exe = fs.readdirSync(p.location).find((f) => /\.exe$/i.test(f) && !/unins|setup|update/i.test(f)); if (exe) file = path.join(p.location, exe); } catch (e) {}
      }
    }
    if (!file || !fs.existsSync(file)) continue;
    try { const img = await app.getFileIcon(file, { size: 'normal' }); out[p.id] = img.toDataURL(); } catch (e) {}
  }
  return out;
}

// ---------------- Store apps ----------------
async function storeApps() {
  const r = await ps.json(`
$names = @{}
Get-StartApps | ForEach-Object { if ($_.AppID -match '^([^!]+)!') { $names[$matches[1]] = $_.Name } }
$o = @(Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.SignatureKind -ne 'System' -and -not $_.NonRemovable -and -not $_.IsResourcePackage } | ForEach-Object {
  $n = $names[$_.PackageFamilyName]
  if (-not $n) { $n = $_.Name }
  @{ name = $n; package = $_.PackageFullName; family = $_.PackageFamilyName; publisher = ($_.Publisher -replace '^CN=([^,]+).*','$1'); version = [string]$_.Version; location = $_.InstallLocation; store = ($_.SignatureKind -eq 'Store'); installDate = $(try { (Get-Item -LiteralPath $_.InstallLocation).CreationTime.ToString('yyyy-MM-dd') } catch { $null }) } })
Emit-Result $o`, { timeout: 180000 });
  return ps.arr(r).sort((a, b) => a.name.localeCompare(b.name));
}

async function removeStoreApps(opts, ctx = {}) {
  const res = await ps.json(`
$r = @()
foreach ($p in $A) { try { Remove-AppxPackage -Package $p -ErrorAction Stop; $r += @{ package = $p; ok = $true } } catch { $r += @{ package = $p; ok = $false; error = $_.Exception.Message } } }
Emit-Result @($r)`, { args: opts.packages, timeout: 900000 });
  const ok = ps.arr(res).filter((x) => x.ok).length;
  store.addStat('programsUninstalled', ok, { type: 'uninstall', items: ok });
  return ps.arr(res);
}

// ---------------- Browser extensions ----------------
const CHROMIUM_ROOTS = [
  { id: 'chrome', name: 'Google Chrome', exe: 'chrome.exe', root: '%LOCALAPPDATA%\\Google\\Chrome\\User Data' },
  { id: 'edge', name: 'Microsoft Edge', exe: 'msedge.exe', root: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data' },
  { id: 'brave', name: 'Brave', exe: 'brave.exe', root: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data' },
  { id: 'vivaldi', name: 'Vivaldi', exe: 'vivaldi.exe', root: '%LOCALAPPDATA%\\Vivaldi\\User Data' },
  { id: 'opera', name: 'Opera', exe: 'opera.exe', root: '%APPDATA%\\Opera Software\\Opera Stable', single: true }
];

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } }

function extName(dir, manifest) {
  let n = manifest.name || '';
  const m = n.match(/^__MSG_(.+)__$/);
  if (m) {
    const loc = manifest.default_locale || 'en';
    for (const l of ['it', loc, 'en', 'en_US']) {
      const msgs = readJson(path.join(dir, '_locales', l, 'messages.json'));
      if (msgs) {
        const key = Object.keys(msgs).find((k) => k.toLowerCase() === m[1].toLowerCase());
        if (key) { n = msgs[key].message; break; }
      }
    }
  }
  return n;
}

async function extensions() {
  const out = [];
  for (const b of CHROMIUM_ROOTS) {
    const root = fsu.env(b.root);
    if (!fs.existsSync(root)) continue;
    const profiles = b.single ? [root] : fs.readdirSync(root).filter((n) => n === 'Default' || /^Profile \d+$/.test(n)).map((n) => path.join(root, n));
    for (const prof of profiles) {
      const extDir = path.join(prof, 'Extensions');
      if (!fs.existsSync(extDir)) continue;
      const prefs = readJson(path.join(prof, 'Secure Preferences')) || {};
      const prefs2 = readJson(path.join(prof, 'Preferences')) || {};
      const settings = Object.assign({}, (prefs2.extensions || {}).settings, (prefs.extensions || {}).settings);
      for (const id of fs.readdirSync(extDir)) {
        const d = path.join(extDir, id);
        let vers = [];
        try { vers = fs.readdirSync(d).filter((v) => fs.statSync(path.join(d, v)).isDirectory()); } catch (e) { continue; }
        if (!vers.length) continue;
        const vdir = path.join(d, vers.sort().pop());
        const mf = readJson(path.join(vdir, 'manifest.json'));
        if (!mf) continue;
        const st = settings[id] || {};
        if (st.location === 5 || st.location === 10) continue; // component / external component
        const iconRel = mf.icons ? mf.icons[Object.keys(mf.icons).sort((a, b) => b - a)[0]] : null;
        let icon = null;
        if (iconRel) { try { const f = path.join(vdir, iconRel); if (fs.statSync(f).size < 200000) icon = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); } catch (e) {} }
        out.push({ browser: b.name, browserId: b.id, exe: b.exe, profile: path.basename(prof), profileDir: prof, id, name: extName(vdir, mf) || id, version: mf.version, description: (extName(vdir, { name: mf.description || '', default_locale: mf.default_locale }) || '').slice(0, 200), enabled: st.state !== 0 && !(st.disable_reasons && st.disable_reasons.length), icon, dir: d, permissions: (mf.permissions || []).filter((p) => typeof p === 'string').slice(0, 12), kind: 'chromium' });
      }
    }
  }
  // Firefox
  const ini = fsu.env('%APPDATA%\\Mozilla\\Firefox\\profiles.ini');
  if (fs.existsSync(ini)) {
    const txt = fs.readFileSync(ini, 'utf8');
    const profs = [...txt.matchAll(/Path=(.+)/g)].map((m) => m[1].trim());
    for (const p of profs) {
      const dir = /^[A-Za-z]:/.test(p) ? p : path.join(fsu.env('%APPDATA%\\Mozilla\\Firefox'), p.replace(/\//g, '\\'));
      const ej = readJson(path.join(dir, 'extensions.json'));
      if (!ej || !ej.addons) continue;
      for (const a of ej.addons) {
        if (a.location !== 'app-profile' || a.type !== 'extension') continue;
        out.push({ browser: 'Mozilla Firefox', browserId: 'firefox', exe: 'firefox.exe', profile: path.basename(dir), profileDir: dir, id: a.id, name: (a.defaultLocale && a.defaultLocale.name) || a.id, version: a.version, description: ((a.defaultLocale && a.defaultLocale.description) || '').slice(0, 200), enabled: a.active, icon: null, dir: a.path, kind: 'firefox' });
      }
    }
  }
  return out;
}

function stripExt(obj, id) {
  if (!obj) return false;
  let changed = false;
  if (obj.extensions && obj.extensions.settings && obj.extensions.settings[id]) { delete obj.extensions.settings[id]; changed = true; }
  if (obj.protection && obj.protection.macs && obj.protection.macs.extensions && obj.protection.macs.extensions.settings && obj.protection.macs.extensions.settings[id]) { delete obj.protection.macs.extensions.settings[id]; changed = true; }
  return changed;
}

async function removeExtensions(opts) {
  const items = opts.items;
  const exes = [...new Set(items.map((i) => i.exe))];
  for (const e of exes) await ps.exec('taskkill.exe', ['/IM', e, '/F', '/T']);
  await new Promise((r) => setTimeout(r, 1500));
  const res = [];
  for (const it of items) {
    try {
      if (it.kind === 'chromium') {
        for (const f of ['Preferences', 'Secure Preferences']) {
          const fp = path.join(it.profileDir, f);
          const j = readJson(fp);
          if (stripExt(j, it.id)) fs.writeFileSync(fp, JSON.stringify(j));
        }
        fs.rmSync(it.dir, { recursive: true, force: true });
        for (const sub of ['Local Extension Settings', 'Extension State', 'Sync Extension Settings', 'Extension Rules']) {
          const d = path.join(it.profileDir, sub, it.id);
          if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        }
      } else {
        if (it.dir && fs.existsSync(it.dir)) fs.rmSync(it.dir, { recursive: true, force: true });
        const ej = path.join(it.profileDir, 'extensions.json');
        const j = readJson(ej);
        if (j && j.addons) { j.addons = j.addons.filter((a) => a.id !== it.id); fs.writeFileSync(ej, JSON.stringify(j)); }
      }
      res.push({ id: it.id, ok: true });
    } catch (e) { res.push({ id: it.id, ok: false, error: String(e.message) }); }
  }
  return res;
}

// ---------------- Uninstall + leftovers ----------------
function normalizeName(n) {
  return String(n || '').replace(/\(.*?\)/g, ' ').replace(/\b(v?\d+(\.\d+)+|x64|x86|64-?bit|32-?bit|version|edition|en-us|it-it)\b/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function waitForUninstaller(child) {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = () => {
      // keep waiting while typical uninstaller helper processes are alive (NSIS Au_.exe, Inno _iu*.tmp, InstallShield)
      const t = setInterval(async () => {
        const r = await ps.exec('tasklist.exe', ['/FO', 'CSV', '/NH']);
        const busy = /"(Au_\.exe|Un_A\.exe|Un\.exe|_iu\w*\.tmp|unins\d*\.exe|uninst\w*\.exe|uninstall\w*\.exe|is-\w+\.tmp|ISBEW64\.exe)"/i.test(r.stdout);
        if (!busy || Date.now() - started > 45 * 60 * 1000) { clearInterval(t); resolve(); }
      }, 2000);
    };
    child.on('close', () => setTimeout(done, 1500));
    child.on('error', () => resolve());
  });
}

function buildCommand(p, quiet) {
  let cmd = (quiet && p.quiet) ? p.quiet : p.uninstall;
  const guid = (p.keyName && /^\{[0-9A-F-]{36}\}$/i.test(p.keyName)) ? p.keyName : ((cmd || '').match(/\{[0-9A-F-]{36}\}/i) || [])[0];
  if (p.msi && guid) return { file: 'msiexec.exe', args: ['/x', guid].concat(quiet ? ['/qn', '/norestart'] : []) };
  if (quiet && !p.quiet && cmd) {
    // common silent switches for known installers
    if (/unins\d*\.exe/i.test(cmd)) cmd += ' /VERYSILENT /SUPPRESSMSGBOXES /NORESTART';
    else if (/uninst(all)?\.exe/i.test(cmd) || /\\Uninstall[^\\]*\.exe/i.test(cmd)) cmd += ' /S';
  }
  return { shell: cmd };
}

async function runUninstaller(opts, ctx = {}) {
  const p = opts.program;
  if (opts.restorePoint && store.settings().createRestorePoint) {
    if (ctx.progress) ctx.progress({ percent: 5, label: 'Creazione del punto di ripristino…' });
    const rp = await undo.createRestorePoint('NovaTune - Prima di disinstallare ' + p.name);
    if (rp && rp.ok) undo.add({ type: 'restorepoint', title: `Punto di ripristino creato prima di disinstallare ${p.name}`, detail: 'Usa Ripristino configurazione di sistema per annullare.', data: {} });
  }
  if (ctx.progress) ctx.progress({ percent: 20, label: `Disinstallazione di ${p.name} in corso… completa la procedura guidata se richiesto.` });
  const c = buildCommand(p, !!opts.quiet);
  let child;
  if (c.file) child = spawn(c.file, c.args, { windowsHide: false });
  else {
    if (!c.shell) throw new Error('Comando di disinstallazione non disponibile');
    child = spawn(c.shell, { shell: true, windowsHide: false });
  }
  await waitForUninstaller(child);
  const stillThere = await ps.json(`Emit-Result @{ exists = (Test-Path -LiteralPath ('Registry::' + $A.k)) }`, { args: { k: p.key } });
  return { ok: true, removed: !stillThere.exists };
}

function isSafeFolder(p, protectedSet) {
  if (!p) return false;
  const n = path.resolve(p).toLowerCase().replace(/\\+$/, '');
  if (n.length < 8) return false;
  const bad = ['%ProgramFiles%', '%ProgramFiles(x86)%', '%ProgramData%', '%APPDATA%', '%LOCALAPPDATA%', '%USERPROFILE%', '%SystemRoot%', '%SystemDrive%\\Users', '%PUBLIC%', '%CommonProgramFiles%', '%CommonProgramFiles(x86)%', '%USERPROFILE%\\AppData\\LocalLow', '%USERPROFILE%\\Documents', '%USERPROFILE%\\Desktop', '%USERPROFILE%\\Downloads'].map((x) => fsu.env(x).toLowerCase());
  if (bad.includes(n)) return false;
  if (n.startsWith(fsu.env('%SystemRoot%').toLowerCase())) return false;
  if (/\\(microsoft|windows|windowsapps|common files|nvidia corporation|intel|amd|packages)$/i.test(n)) return false;
  for (const prot of protectedSet) if (prot === n || prot.startsWith(n + '\\')) return false; // contains another installed program
  return true;
}

async function scanLeftovers(opts, ctx = {}) {
  const p = opts.program; // {name, publisher, location, key, keyName}
  if (ctx.progress) ctx.progress({ percent: 30, label: 'Ricerca di file e voci di registro residui…' });
  const all = cache || await list();
  const others = all.filter((x) => x.key !== p.key);
  const protectedSet = new Set(others.map((x) => x.location).filter(Boolean).map((l) => path.resolve(l).toLowerCase().replace(/\\+$/, '')));
  const nName = normalizeName(p.name);
  const words = nName.split(' ').filter((w) => w.length > 1);
  const pubN = normalizeName(p.publisher).split(' ')[0] || '';
  const locBase = p.location ? path.basename(p.location.replace(/\\+$/, '')) : '';
  const candidatesNames = [...new Set([p.name, nName, words.slice(0, 2).join(' '), words[0] && words[0].length > 3 ? words[0] : null, locBase].filter((x) => x && x.length > 2))];
  const matchName = (folderName) => {
    const f = normalizeName(folderName);
    if (!f) return false;
    if (locBase && folderName.toLowerCase() === locBase.toLowerCase()) return true;
    if (f === nName) return true;
    if (words.length && f.replace(/ /g, '') === words.join('')) return true;
    if (words.length >= 2 && f === words.slice(0, 2).join(' ')) return true;
    if (words.length === 1 && f === words[0]) return true;
    return false;
  };
  const files = [];
  const addFolder = async (dir, reason) => {
    if (!dir || !fs.existsSync(dir) || !isSafeFolder(dir, protectedSet)) return;
    if (files.some((f) => f.path.toLowerCase() === dir.toLowerCase())) return;
    const s = await fsu.dirSize(dir);
    files.push({ path: dir, size: s.size, count: s.count, reason, type: 'folder', selected: true });
  };
  if (p.location) await addFolder(p.location.replace(/"/g, ''), 'Cartella di installazione');
  const bases = ['%ProgramFiles%', '%ProgramFiles(x86)%', '%ProgramData%', '%APPDATA%', '%LOCALAPPDATA%', '%USERPROFILE%\\AppData\\LocalLow', '%LOCALAPPDATA%\\Programs', '%CommonProgramFiles%', '%CommonProgramFiles(x86)%', '%USERPROFILE%\\Documents'].map(fsu.env);
  for (const b of bases) {
    let ents = [];
    try { ents = fs.readdirSync(b, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (e) { continue; }
    for (const e of ents) {
      const full = path.join(b, e.name);
      if (matchName(e.name)) await addFolder(full, 'Dati del programma');
      else if (pubN && pubN.length > 2 && normalizeName(e.name).split(' ')[0] === pubN && !/microsoft/i.test(pubN)) {
        // publisher folder: look one level deeper
        let sub = [];
        try { sub = fs.readdirSync(full, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch (er) {}
        for (const s of sub) if (matchName(s.name)) await addFolder(path.join(full, s.name), 'Dati del programma (editore)');
        // publisher folder that only contained this program
        if (sub.length <= 1 && sub.every((s) => matchName(s.name))) await addFolder(full, 'Cartella dell\'editore');
      }
    }
  }
  // Start menu folders / shortcuts
  for (const sm of ['%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs', '%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs'].map(fsu.env)) {
    let ents = [];
    try { ents = fs.readdirSync(sm, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const full = path.join(sm, e.name);
      if (e.isDirectory() && matchName(e.name)) await addFolder(full, 'Menu Start');
      else if (e.isFile() && /\.lnk$/i.test(e.name) && matchName(e.name.replace(/\.lnk$/i, ''))) files.push({ path: full, size: fs.statSync(full).size, count: 1, reason: 'Collegamento nel menu Start', type: 'file', selected: true });
    }
  }
  for (const dk of ['%USERPROFILE%\\Desktop', '%PUBLIC%\\Desktop'].map(fsu.env)) {
    let ents = [];
    try { ents = fs.readdirSync(dk, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) if (e.isFile() && /\.lnk$/i.test(e.name) && matchName(e.name.replace(/\.lnk$/i, ''))) { const full = path.join(dk, e.name); files.push({ path: full, size: fs.statSync(full).size, count: 1, reason: 'Collegamento sul desktop', type: 'file', selected: true }); }
  }

  if (ctx.progress) ctx.progress({ percent: 65, label: 'Analisi del registro di sistema…' });
  const reg = await ps.json(`
$names = @($A.names)
$loc = $A.loc
$pub = $A.pub
$found = New-Object System.Collections.ArrayList
function Add-K($k, $why) { if (Test-Path -LiteralPath ('Registry::' + $k)) { if (-not ($found | Where-Object { $_.key -eq $k })) { [void]$found.Add(@{ key = $k; reason = $why; type = 'key' }) } } }
if ($A.key) { Add-K $A.key 'Voce di disinstallazione' }
foreach ($root in @('HKEY_CURRENT_USER\\Software','HKEY_LOCAL_MACHINE\\SOFTWARE','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node')) {
  $rk = Get-Item -LiteralPath ('Registry::' + $root) -ErrorAction SilentlyContinue
  if (-not $rk) { continue }
  foreach ($sk in $rk.GetSubKeyNames()) {
    if ($sk -match '^(Microsoft|Classes|Policies|Wow6432Node|Clients|RegisteredApplications|Intel|Windows|ODBC|Khronos|Wow6432Node)$') { continue }
    foreach ($n in $names) { if ($sk -ieq $n) { Add-K ($root + '\\' + $sk) 'Chiave del programma' } }
    if ($pub -and $sk -ieq $pub) {
      $pk = $rk.OpenSubKey($sk)
      if ($pk) { $subs = $pk.GetSubKeyNames(); foreach ($s in $subs) { foreach ($n in $names) { if ($s -ieq $n) { Add-K ($root + '\\' + $sk + '\\' + $s) "Chiave del programma ($pub)" } } }
        if ($subs.Count -le 1 -and ($subs | Where-Object { $names -contains $_ }).Count -eq $subs.Count) { Add-K ($root + '\\' + $sk) "Chiave dell'editore" } }
    }
  }
}
$vals = New-Object System.Collections.ArrayList
$services = @(); $tasks = @()
if ($loc -and $loc.Length -gt 8) {
  $locL = $loc.TrimEnd('\\').ToLower()
  foreach ($rk in @('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')) {
    $i = Get-Item -LiteralPath ('Registry::' + $rk) -ErrorAction SilentlyContinue
    if ($i) { foreach ($n in $i.GetValueNames()) { if ([string]$i.GetValue($n) -and ([string]$i.GetValue($n)).ToLower().Contains($locL)) { [void]$vals.Add(@{ key = $rk; value = $n; reason = 'Avvio automatico'; type = 'value' }) } } }
  }
  foreach ($ap in @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {
    Get-ChildItem -LiteralPath ('Registry::' + $ap) -ErrorAction SilentlyContinue | ForEach-Object { $d = [string]$_.GetValue(''); if ($d -and $d.ToLower().Contains($locL)) { Add-K ($ap + '\\' + $_.PSChildName) 'Percorso applicazione' } }
  }
  $services = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.ToLower().Contains($locL) } | ForEach-Object { @{ name = $_.Name; display = $_.DisplayName; reason = 'Servizio'; type = 'service' } })
  $tasks = @(Get-ScheduledTask | Where-Object { ($_.Actions | Where-Object { $_.Execute -and ([Environment]::ExpandEnvironmentVariables($_.Execute)).ToLower().Contains($locL) }) } | ForEach-Object { @{ path = $_.TaskPath; name = $_.TaskName; reason = 'Attività pianificata'; type = 'task' } })
}
foreach ($n in $names) { Add-K ('HKEY_CURRENT_USER\\Software\\Classes\\Applications\\' + $n + '.exe') 'Associazione file' }
Emit-Result @{ keys = @($found); values = @($vals); services = $services; tasks = $tasks }`, { args: { names: candidatesNames, loc: p.location || '', pub: (p.publisher || '').split(/[ ,]/)[0], key: opts.includeUninstallKey === false ? null : p.key }, timeout: 300000 });
  const registry = [
    ...ps.arr(reg.keys).map((k) => Object.assign(k, { selected: true })),
    ...ps.arr(reg.values).map((k) => Object.assign(k, { selected: true }))
  ];
  const other = [...ps.arr(reg.services), ...ps.arr(reg.tasks)].map((k) => Object.assign(k, { selected: true }));
  return { files, registry, other, totalSize: files.reduce((a, f) => a + f.size, 0) };
}

async function removeLeftovers(opts, ctx = {}) {
  const { files = [], registry = [], other = [], programName = '' } = opts;
  const b = undo.newBackupDir();
  if (ctx.progress) ctx.progress({ percent: 20, label: 'Backup del registro…' });
  const keysToExport = [...new Set(registry.map((r) => r.key))];
  const regFiles = await undo.exportKeys(keysToExport, b.dir);
  if (ctx.progress) ctx.progress({ percent: 40, label: 'Rimozione di servizi e attività…' });
  if (other.length) {
    await ps.json(`
foreach ($o in $A) {
  if ($o.type -eq 'service') { Stop-Service -Name $o.name -Force -ErrorAction SilentlyContinue; & sc.exe delete $o.name | Out-Null }
  if ($o.type -eq 'task') { Unregister-ScheduledTask -TaskPath $o.path -TaskName $o.name -Confirm:$false -ErrorAction SilentlyContinue }
}
Emit-Result @{ok=$true}`, { args: other });
  }
  if (ctx.progress) ctx.progress({ percent: 60, label: 'Rimozione delle voci di registro…' });
  let regRemoved = 0;
  if (registry.length) {
    const r = await ps.json(`
$n = 0
foreach ($it in $A) { $p = 'Registry::' + $it.key
  try { if ($it.type -eq 'value') { Remove-ItemProperty -LiteralPath $p -Name $it.value -Force -ErrorAction Stop } else { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop }; $n++ } catch {} }
Emit-Result @{ n = $n }`, { args: registry });
    regRemoved = r.n;
  }
  if (ctx.progress) ctx.progress({ percent: 80, label: 'Rimozione dei file residui…' });
  // kill processes running from the folders first
  const folders = files.filter((f) => f.type === 'folder').map((f) => f.path);
  if (folders.length) await ps.run(`foreach ($p in $A) { Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($p, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue }; Emit-Result @{ok=$true}`, { args: folders });
  let filesRemoved = 0, freed = 0; const failed = [];
  for (const f of files) {
    try {
      let done = false;
      if (opts.toRecycleBin !== false && electronShell) { try { await electronShell.trashItem(f.path); done = true; } catch (e) {} }
      if (!done) await fsp.rm(f.path, { recursive: true, force: true, maxRetries: 2 });
      if (fs.existsSync(f.path)) {
        // schedule deletion at next reboot for locked files
        await ps.run(`& cmd.exe /c rd /s /q "$($A.p)" 2>$null; Emit-Result @{ok=$true}`, { args: { p: f.path } });
      }
      if (!fs.existsSync(f.path)) { filesRemoved++; freed += f.size || 0; } else failed.push(f.path);
    } catch (e) { failed.push(f.path); }
  }
  undo.add({ id: b.id, backupDir: b.dir, type: 'uninstall', title: `Residui di ${programName || 'un programma'} rimossi`, detail: [...files.map((f) => f.path), ...registry.map((r) => r.key + (r.value ? ' → ' + r.value : ''))].slice(0, 80).join('\n') + (opts.toRecycleBin !== false ? '\n\nI file sono stati spostati nel Cestino.' : ''), data: { regFiles } });
  store.addStat('leftoversRemoved', filesRemoved + regRemoved);
  store.addStat('spaceFreed', freed);
  return { filesRemoved, regRemoved, freed, failed };
}

async function markUninstalled(name) {
  store.addStat('programsUninstalled', 1, { type: 'uninstall', items: 1, name });
  cache = null;
}

/** Forced uninstall: user points to a folder or program name (program is broken / has no uninstaller) */
async function forcedScan(opts, ctx = {}) {
  let p = { name: opts.name || '', publisher: '', location: opts.folder || '', key: null };
  if (opts.folder && !opts.name) p.name = path.basename(opts.folder);
  if (opts.folder) {
    const all = cache || await list();
    const match = all.find((x) => x.location && path.resolve(x.location).toLowerCase() === path.resolve(opts.folder).toLowerCase());
    if (match) p = match;
  }
  const res = await scanLeftovers({ program: p }, ctx);
  return Object.assign(res, { program: p });
}

async function openExtensionsPage(opts) {
  const map = { chrome: 'chrome://extensions', edge: 'edge://extensions', brave: 'brave://extensions', vivaldi: 'vivaldi://extensions', opera: 'opera://extensions', firefox: 'about:addons' };
  await ps.run(`Start-Process $A.exe -ArgumentList $A.url; Emit-Result @{ok=$true}`, { args: { exe: opts.exe, url: map[opts.browserId] || '' } });
  return { ok: true };
}

module.exports = { list, icons, storeApps, removeStoreApps, extensions, removeExtensions, runUninstaller, scanLeftovers, removeLeftovers, markUninstalled, forcedScan, openExtensionsPage, normalizeName };
