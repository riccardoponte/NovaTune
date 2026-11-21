// Broken shortcuts finder
const fs = require('fs');
const path = require('path');
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');

let last = [];

async function scan(opts = {}, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 10, label: 'Ricerca dei collegamenti…' });
  const r = await ps.json(`
$sh = New-Object -ComObject WScript.Shell
$locs = @(
  @{ n='Desktop'; p=[Environment]::GetFolderPath('Desktop') },
  @{ n='Desktop pubblico'; p=[Environment]::GetFolderPath('CommonDesktopDirectory') },
  @{ n='Menu Start'; p=[Environment]::GetFolderPath('StartMenu') },
  @{ n='Menu Start (tutti gli utenti)'; p=[Environment]::GetFolderPath('CommonStartMenu') },
  @{ n='Avvio rapido'; p=(Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch') },
  @{ n='Invia a'; p=[Environment]::GetFolderPath('SendTo') }
)
$out = @()
foreach ($l in $locs) {
  if (-not $l.p -or -not (Test-Path -LiteralPath $l.p)) { continue }
  Get-ChildItem -LiteralPath $l.p -Recurse -Force -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $s = $sh.CreateShortcut($_.FullName)
      $t = $s.TargetPath
      if ([string]::IsNullOrWhiteSpace($t)) { return }
      $t = [Environment]::ExpandEnvironmentVariables($t)
      if ($t.StartsWith('\\\\')) { return }
      if ($t -match '^[A-Za-z]:') { $root = $t.Substring(0,3); if (-not (Test-Path -LiteralPath $root)) { return } } else { return }
      # 32-bit redirection safety: try sysnative / Program Files variants
      $exists = Test-Path -LiteralPath $t
      if (-not $exists -and $t -match 'Program Files \\(x86\\)') { $exists = Test-Path -LiteralPath ($t -replace 'Program Files \\(x86\\)','Program Files') }
      if (-not $exists -and $t -match '\\\\Program Files\\\\') { $exists = Test-Path -LiteralPath ($t -replace '\\\\Program Files\\\\','\\Program Files (x86)\\') }
      if (-not $exists -and $t -match '\\\\System32\\\\') { $exists = Test-Path -LiteralPath ($t -replace '\\\\System32\\\\','\\Sysnative\\') }
      if (-not $exists) { $out += @{ path = $_.FullName; name = $_.BaseName; target = $t; location = $l.n } }
    } catch {}
  }
}
Emit-Result @($out)`);
  const ignored = new Set(store.settings().ignored.shortcuts || []);
  last = ps.arr(r).map((x) => Object.assign(x, { ignored: ignored.has(x.path) }));
  return { items: last, count: last.filter((x) => !x.ignored).length };
}

async function clean(opts = {}) {
  const paths = opts.paths || last.filter((x) => !x.ignored).map((x) => x.path);
  if (!paths.length) return { removed: 0 };
  const b = undo.newBackupDir();
  const files = [];
  let i = 0;
  for (const p of paths) {
    try {
      const bk = path.join(b.dir, `${i++}_${path.basename(p)}`);
      fs.copyFileSync(p, bk);
      fs.unlinkSync(p);
      files.push({ original: p, backup: bk });
    } catch (e) {}
  }
  if (files.length) {
    undo.add({ id: b.id, backupDir: b.dir, type: 'shortcuts', title: `${files.length} collegamenti interrotti rimossi`, detail: files.map((f) => f.original).join('\n'), data: { files } });
  }
  store.addStat('shortcutsRemoved', files.length, { type: 'shortcuts', items: files.length });
  last = [];
  return { removed: files.length };
}

module.exports = { scan, clean };
