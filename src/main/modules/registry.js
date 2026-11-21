// Registry cleaner (with automatic .reg backup in the Undo Center)
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');

const CATS = {
  SharedDLLs: { name: 'DLL condivise', tip: 'Riferimenti a librerie condivise (DLL) che non esistono più sul disco.' },
  OpenWith: { name: 'Apri con', tip: 'Programmi registrati nel menu "Apri con" che sono stati rimossi.' },
  ObsoleteSoftware: { name: 'Software obsoleto', tip: 'Voci di disinstallazione di programmi già rimossi dal PC.' },
  MUICache: { name: 'Cache MUI', tip: 'Nomi memorizzati di programmi eseguiti in passato e non più presenti.' },
  InstallerFolders: { name: 'Cartelle di installazione', tip: 'Cartelle registrate da Windows Installer che non esistono più.' },
  HelpFiles: { name: 'File della Guida', tip: 'Riferimenti a file della Guida mancanti.' },
  Fonts: { name: 'Tipi di carattere', tip: 'Tipi di carattere registrati il cui file è stato eliminato.' },
  ApplicationPaths: { name: 'Percorsi delle applicazioni', tip: 'Percorsi di applicazioni (App Paths) che puntano a file inesistenti.' },
  Autorun: { name: 'Esecuzione automatica', tip: 'Voci di avvio automatico che puntano a programmi inesistenti.' },
  RecentFilesKeys: { name: 'Elenchi file recenti', tip: 'Elenchi di file recenti di Office, Paint e WordPad che puntano a file eliminati.' }
};

const SCAN = `
function Get-ExePath([string]$cmd) {
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables($cmd).Trim()
  if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 1) { return $c.Substring(1, $e - 1) } }
  $m = [regex]::Match($c, '^(.+?\\.(exe|com|bat|cmd|dll|scr|vbs|lnk|cpl|msc|ps1))(\\s|,|$)', 'IgnoreCase')
  if ($m.Success) { return $m.Groups[1].Value }
  return ($c -split ' ')[0]
}
function Test-Missing([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $false }
  $p = [Environment]::ExpandEnvironmentVariables($p.Trim().Trim('"'))
  if ($p.StartsWith('\\\\')) { return $false }
  if ($p -notmatch '^[A-Za-z]:\\\\') {
    foreach ($d in @("$env:windir\\System32", "$env:windir\\SysWOW64", $env:windir)) { if (Test-Path -LiteralPath (Join-Path $d $p)) { return $false } }
    return $false
  }
  $root = $p.Substring(0,3); if (-not (Test-Path -LiteralPath $root)) { return $false }
  if (Test-Path -LiteralPath $p) { return $false }
  if ($p -match '\\\\System32\\\\' -and (Test-Path -LiteralPath ($p -replace '\\\\System32\\\\','\\Sysnative\\'))) { return $false }
  if ($p -match '\\\\System32\\\\' -and (Test-Path -LiteralPath ($p -replace '\\\\System32\\\\','\\SysWOW64\\'))) { return $false }
  return $true
}
$issues = New-Object System.Collections.ArrayList
function Add-Issue($cat, $key, $value, $detail) { [void]$issues.Add(@{ cat = $cat; key = $key; value = $value; detail = $detail }) }
function Keys($list) { foreach ($k in $list) { if (Test-Path -LiteralPath ('Registry::' + $k)) { $k } } }
function Get-Vals($k) { $i = Get-Item -LiteralPath ('Registry::' + $k) -ErrorAction SilentlyContinue; if ($i) { foreach ($n in $i.GetValueNames()) { @{ name = $n; data = $i.GetValue($n, $null, 'DoNotExpandEnvironmentNames') } } } }

$cats = $A
if ($cats -contains 'SharedDLLs') {
  Emit-Progress @{ label = 'DLL condivise'; percent = 5 }
  foreach ($k in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs')) {
    foreach ($v in Get-Vals $k) { if ($v.name -and (Test-Missing $v.name)) { Add-Issue 'SharedDLLs' $k $v.name $v.name } } }
}
if ($cats -contains 'OpenWith') {
  Emit-Progress @{ label = 'Apri con'; percent = 15 }
  $ap = 'HKEY_CURRENT_USER\\Software\\Classes\\Applications'
  if (Test-Path -LiteralPath ('Registry::' + $ap)) {
    Get-ChildItem -LiteralPath ('Registry::' + $ap) | ForEach-Object {
      $app = $_.PSChildName
      $cmdKey = Get-ChildItem -LiteralPath ($_.PSPath + '\\shell') -ErrorAction SilentlyContinue | ForEach-Object { Get-Item -LiteralPath ($_.PSPath + '\\command') -ErrorAction SilentlyContinue } | Select-Object -First 1
      if ($cmdKey) { $exe = Get-ExePath ($cmdKey.GetValue('')); if (Test-Missing $exe) { Add-Issue 'OpenWith' ($ap + '\\' + $app) $null $exe } }
    }
  }
}
if ($cats -contains 'ObsoleteSoftware') {
  Emit-Progress @{ label = 'Software obsoleto'; percent = 25 }
  foreach ($root in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
    Get-ChildItem -LiteralPath ('Registry::' + $root) | ForEach-Object {
      $u = $_.GetValue('UninstallString'); $loc = $_.GetValue('InstallLocation'); $dn = $_.GetValue('DisplayName')
      if (-not $u -or $_.GetValue('SystemComponent') -eq 1) { return }
      if ($u -match 'msiexec' -or $u -match 'rundll32') { return }
      $exe = Get-ExePath $u
      if ((Test-Missing $exe) -and (-not $loc -or (Test-Missing $loc))) { Add-Issue 'ObsoleteSoftware' ($root + '\\' + $_.PSChildName) $null ("$dn  ($exe)") }
    }
  }
}
if ($cats -contains 'MUICache') {
  Emit-Progress @{ label = 'Cache MUI'; percent = 35 }
  foreach ($k in Keys @('HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache')) {
    foreach ($v in Get-Vals $k) { if ($v.name -match '^(.+?\\.exe)\\.(FriendlyAppName|ApplicationCompany)$') { if (Test-Missing $matches[1]) { Add-Issue 'MUICache' $k $v.name $matches[1] } } } }
}
if ($cats -contains 'InstallerFolders') {
  Emit-Progress @{ label = 'Cartelle di installazione'; percent = 45 }
  foreach ($k in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\Folders')) {
    foreach ($v in Get-Vals $k) { if (Test-Missing $v.name) { Add-Issue 'InstallerFolders' $k $v.name $v.name } } }
}
if ($cats -contains 'HelpFiles') {
  Emit-Progress @{ label = 'File della Guida'; percent = 55 }
  foreach ($k in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\Help','HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\HTML Help','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\Help','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\HTML Help')) {
    foreach ($v in Get-Vals $k) { if ($v.name -and $v.data -is [string]) { $f = Join-Path ([Environment]::ExpandEnvironmentVariables($v.data)) $v.name; if (Test-Missing $f) { Add-Issue 'HelpFiles' $k $v.name $f } } } }
}
if ($cats -contains 'Fonts') {
  Emit-Progress @{ label = 'Tipi di carattere'; percent = 65 }
  foreach ($k in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')) {
    foreach ($v in Get-Vals $k) { if ($v.data -is [string] -and $v.data) {
      $f = [Environment]::ExpandEnvironmentVariables($v.data)
      if ($f -notmatch '^[A-Za-z]:\\\\') { $f = Join-Path "$env:windir\\Fonts" $f }
      if (Test-Missing $f) { Add-Issue 'Fonts' $k $v.name $f } } } }
}
if ($cats -contains 'ApplicationPaths') {
  Emit-Progress @{ label = 'Percorsi delle applicazioni'; percent = 75 }
  foreach ($root in Keys @('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {
    Get-ChildItem -LiteralPath ('Registry::' + $root) | ForEach-Object { $d = $_.GetValue(''); if ($d) { $exe = Get-ExePath $d; if (Test-Missing $exe) { Add-Issue 'ApplicationPaths' ($root + '\\' + $_.PSChildName) $null $exe } } }
  }
}
if ($cats -contains 'Autorun') {
  Emit-Progress @{ label = 'Esecuzione automatica'; percent = 85 }
  foreach ($k in Keys @('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce','HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce')) {
    foreach ($v in Get-Vals $k) { if ($v.data -is [string]) { $exe = Get-ExePath $v.data; if (Test-Missing $exe) { Add-Issue 'Autorun' $k $v.name $exe } } } }
}
if ($cats -contains 'RecentFilesKeys') {
  Emit-Progress @{ label = 'Elenchi file recenti'; percent = 95 }
  $mru = @('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Paint\\Recent File List','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Wordpad\\Recent File List')
  foreach ($ver in @('16.0','15.0')) { foreach ($app in @('Word','Excel','PowerPoint','Access','Publisher','Visio')) { $mru += "HKEY_CURRENT_USER\\Software\\Microsoft\\Office\\$ver\\$app\\File MRU"; $mru += "HKEY_CURRENT_USER\\Software\\Microsoft\\Office\\$ver\\$app\\Place MRU" } }
  foreach ($k in Keys $mru) {
    foreach ($v in Get-Vals $k) { if ($v.data -is [string]) { $p = $v.data; if ($p -match '\\*([A-Za-z]:\\\\.*)$') { $p = $matches[1] }; if ($p -match '^[A-Za-z]:\\\\' -and (Test-Missing $p)) { Add-Issue 'RecentFilesKeys' $k $v.name $p } } } }
}
Emit-Result @($issues)
`;

let last = [];

async function scan(opts = {}, ctx = {}) {
  const cats = opts.categories || Object.keys(CATS);
  const r = await ps.json(SCAN, { args: cats, onProgress: ctx.progress, timeout: 600000 });
  const ignored = new Set(store.settings().ignored.registry || []);
  last = ps.arr(r).map((x, i) => Object.assign(x, { id: i, catName: CATS[x.cat].name, ignored: ignored.has(x.key + '|' + (x.value || '')) }));
  const groups = Object.keys(CATS).map((k) => ({ id: k, name: CATS[k].name, tip: CATS[k].tip, count: last.filter((x) => x.cat === k && !x.ignored).length }));
  return { items: last, groups, count: last.filter((x) => !x.ignored).length };
}

async function clean(opts = {}) {
  const items = opts.ids ? last.filter((x) => opts.ids.includes(x.id)) : last.filter((x) => !x.ignored && (!opts.categories || opts.categories.includes(x.cat)));
  if (!items.length) return { removed: 0 };
  const b = undo.newBackupDir();
  const keys = [...new Set(items.map((x) => x.key))];
  const regFiles = await undo.exportKeys(keys, b.dir);
  const r = await ps.json(`
$n = 0
foreach ($it in $A) {
  $p = 'Registry::' + $it.key
  try {
    if ($it.value -ne $null) { Remove-ItemProperty -LiteralPath $p -Name $it.value -Force -ErrorAction Stop }
    else { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop }
    $n++
  } catch {}
}
Emit-Result @{ removed = $n }`, { args: items.map((x) => ({ key: x.key, value: x.value == null ? null : x.value })) });
  undo.add({ id: b.id, backupDir: b.dir, type: 'registry', title: `${r.removed} problemi del registro risolti`, detail: items.slice(0, 50).map((x) => `${x.catName}: ${x.detail}`).join('\n'), data: { regFiles } });
  store.addStat('registryItems', r.removed, { type: 'registry', items: r.removed });
  last = [];
  return r;
}

module.exports = { scan, clean, categories: () => CATS };
