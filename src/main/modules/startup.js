// Startup manager + Sleep Mode (puts background components of a program to sleep)
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');

const SCAN = `
function Get-ExePath([string]$cmd) {
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables($cmd).Trim()
  if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 1) { return $c.Substring(1, $e - 1) } }
  $m = [regex]::Match($c, '^(.+?\\.(exe|com|bat|cmd|vbs|lnk))(\\s|,|$)', 'IgnoreCase')
  if ($m.Success) { return $m.Groups[1].Value }
  return ($c -split ' ')[0]
}
$sh = New-Object -ComObject WScript.Shell
$verCache = @{}
function Get-Ver([string]$exe) {
  if (-not $exe) { return @{} }
  if ($verCache.ContainsKey($exe)) { return $verCache[$exe] }
  $r = @{ company = ''; product = ''; description = ''; size = 0; exists = $false }
  try { $fi = Get-Item -LiteralPath $exe -ErrorAction Stop; $v = $fi.VersionInfo
    $r = @{ company = [string]$v.CompanyName; product = [string]$v.ProductName; description = [string]$v.FileDescription; size = [int64]$fi.Length; exists = $true } } catch {}
  $verCache[$exe] = $r; return $r
}
function Approved($key, $name) {
  try { $b = (Get-Item -LiteralPath ('Registry::' + $key) -ErrorAction Stop).GetValue($name); if ($b -is [byte[]] -and $b.Length -gt 0) { return (($b[0] -band 1) -eq 0) } } catch {}
  return $true
}
$items = New-Object System.Collections.ArrayList
function Add-It($h) { $v = Get-Ver $h.exe; foreach ($k in $v.Keys) { $h[$k] = $v[$k] }; [void]$items.Add($h) }

$runs = @(
  @{ k='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; a='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'; scope='Utente corrente' },
  @{ k='HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; a='HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'; scope='Tutti gli utenti' },
  @{ k='HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; a='HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32'; scope='Tutti gli utenti (32 bit)' }
)
foreach ($r in $runs) {
  $i = Get-Item -LiteralPath ('Registry::' + $r.k) -ErrorAction SilentlyContinue
  if (-not $i) { continue }
  foreach ($n in $i.GetValueNames()) { if (-not $n) { continue }
    $cmd = [string]$i.GetValue($n)
    Add-It @{ kind = 'run'; id = 'run|' + $r.k + '|' + $n; name = $n; command = $cmd; exe = (Get-ExePath $cmd); location = 'Registro: ' + $r.scope; key = $r.k; valueName = $n; approvedKey = $r.a; enabled = (Approved $r.a $n) } }
}
$folders = @(
  @{ p=[Environment]::GetFolderPath('Startup'); a='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'; scope='Utente corrente' },
  @{ p=[Environment]::GetFolderPath('CommonStartup'); a='HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'; scope='Tutti gli utenti' }
)
foreach ($f in $folders) {
  if (-not (Test-Path -LiteralPath $f.p)) { continue }
  Get-ChildItem -LiteralPath $f.p -File -Force | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $exe = $_.FullName; $cmd = $_.FullName
    if ($_.Extension -eq '.lnk') { try { $s = $sh.CreateShortcut($_.FullName); $exe = $s.TargetPath; $cmd = ($s.TargetPath + ' ' + $s.Arguments).Trim() } catch {} }
    Add-It @{ kind = 'folder'; id = 'folder|' + $_.FullName; name = $_.BaseName; command = $cmd; exe = $exe; location = 'Menu Start: ' + $f.scope; file = $_.FullName; valueName = $_.Name; approvedKey = $f.a; enabled = (Approved $f.a $_.Name) }
  }
}
if (-not $A.startupOnly) {
  Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object {
    $act = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1
    if (-not $act) { return }
    $exe = [Environment]::ExpandEnvironmentVariables(($act.Execute).Trim('"'))
    $logon = [bool]($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' })
    Add-It @{ kind = 'task'; id = 'task|' + $_.TaskPath + $_.TaskName; name = $_.TaskName; command = ($exe + ' ' + $act.Arguments).Trim(); exe = $exe; location = 'Attività pianificata'; taskPath = $_.TaskPath; taskName = $_.TaskName; enabled = ($_.State -ne 'Disabled'); atLogon = $logon }
  }
  Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName -notmatch '\\\\Windows\\\\(System32|SysWOW64)\\\\svchost' } | ForEach-Object {
    $exe = Get-ExePath $_.PathName
    if ($exe -and $exe.StartsWith($env:windir, [StringComparison]::OrdinalIgnoreCase)) { return }
    $v = Get-Ver $exe
    if ($v.company -match '^Microsoft') { return }
    Add-It @{ kind = 'service'; id = 'service|' + $_.Name; name = $_.DisplayName; serviceName = $_.Name; command = $_.PathName; exe = $exe; location = 'Servizio'; startMode = $_.StartMode; state = $_.State; enabled = ($_.StartMode -eq 'Auto'); delayed = [bool]$_.DelayedAutoStart }
  }
}
$procs = @(Get-Process | Where-Object { $_.Path } | ForEach-Object { @{ path = $_.Path; mem = [int64]$_.WorkingSet64; cpu = [double]$_.CPU; name = $_.ProcessName; id = $_.Id } })
Emit-Result @{ items = @($items); procs = $procs }
`;

function folderOf(p) {
  if (!p) return '';
  const s = p.replace(/\//g, '\\').toLowerCase();
  // program "home": first 2 levels under Program Files / AppData
  const m = s.match(/^(.*?\\(program files( \(x86\))?|programdata|appdata\\(local|roaming))\\[^\\]+)/);
  if (m) return m[1];
  return s.substring(0, s.lastIndexOf('\\'));
}

function impact(size, mem) {
  const score = (size || 0) / 1048576 + (mem || 0) / (1048576 * 4);
  if (score > 60) return 'high';
  if (score > 15) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

let lastRaw = null;

async function rawScan(startupOnly, ctx) {
  if (ctx && ctx.progress) ctx.progress({ percent: 20, label: 'Analisi dei programmi all\'avvio e in background…' });
  const r = await ps.json(SCAN, { args: { startupOnly: !!startupOnly }, timeout: 300000 });
  r.items = ps.arr(r.items); r.procs = ps.arr(r.procs);
  lastRaw = r;
  return r;
}

// ---------------- Startup manager ----------------
async function listStartup(opts = {}, ctx = {}) {
  const r = await rawScan(false, ctx);
  const memByFolder = {};
  for (const p of r.procs) { const f = folderOf(p.path); memByFolder[f] = (memByFolder[f] || 0) + p.mem; }
  const items = r.items.filter((i) => i.kind === 'run' || i.kind === 'folder' || (i.kind === 'task' && i.atLogon)).map((i) => Object.assign(i, {
    impact: impact(i.size, memByFolder[folderOf(i.exe)]),
    running: r.procs.some((p) => i.exe && p.path.toLowerCase() === String(i.exe).toLowerCase()),
    title: i.description || i.product || i.name
  }));
  return { items };
}

const SET_STARTUP = `
function Set-Approved($key, $name, [bool]$enable) {
  $p = 'Registry::' + $key
  if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
  $b = New-Object byte[] 12
  if ($enable) { $b[0] = 2 } else { $b[0] = 3; [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()).CopyTo($b, 4) }
  New-ItemProperty -LiteralPath $p -Name $name -Value $b -PropertyType Binary -Force | Out-Null
}
$res = @()
foreach ($it in $A.items) {
  $ok = $true
  try {
    switch ($it.kind) {
      'run' { Set-Approved $it.approvedKey $it.valueName ([bool]$it.enable) }
      'folder' { Set-Approved $it.approvedKey $it.valueName ([bool]$it.enable) }
      'task' { if ($it.enable) { Enable-ScheduledTask -TaskPath $it.taskPath -TaskName $it.taskName -ErrorAction Stop | Out-Null } else { Disable-ScheduledTask -TaskPath $it.taskPath -TaskName $it.taskName -ErrorAction Stop | Out-Null } }
      'service' {
        if ($it.enable) {
          $mode = if ($it.restoreMode) { $it.restoreMode } else { 'Auto' }
          if ($mode -eq 'Auto') { & sc.exe config $it.serviceName start= $(if ($it.delayed) { 'delayed-auto' } else { 'auto' }) | Out-Null } elseif ($mode -eq 'Manual') { & sc.exe config $it.serviceName start= demand | Out-Null } else { & sc.exe config $it.serviceName start= disabled | Out-Null }
          if ($mode -eq 'Auto') { Start-Service -Name $it.serviceName -ErrorAction SilentlyContinue }
        } else {
          & sc.exe config $it.serviceName start= demand | Out-Null
          if ($A.stop) { Stop-Service -Name $it.serviceName -Force -ErrorAction SilentlyContinue }
        }
      }
    }
  } catch { $ok = $false }
  $res += @{ id = $it.id; ok = $ok }
}
if ($A.killPaths) { foreach ($p in $A.killPaths) { Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($p, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue } }
Emit-Result @($res)
`;

async function setStartup(opts) {
  // opts: { items: [{...item, enable:bool}] }
  const res = await ps.json(SET_STARTUP, { args: { items: opts.items } });
  for (const it of opts.items) {
    if (opts.noUndo) continue;
    undo.add({ type: 'startup', title: `${it.title || it.name}: avvio automatico ${it.enable ? 'attivato' : 'disattivato'}`, detail: it.command, data: { item: Object.assign({}, it, { enable: !it.enable }) } });
  }
  return ps.arr(res);
}

async function deleteStartup(opts) {
  const it = opts.item;
  const b = undo.newBackupDir();
  const data = {};
  if (it.kind === 'run') {
    data.regFiles = await undo.exportKeys([it.key], b.dir);
    await ps.run(`Remove-ItemProperty -LiteralPath ('Registry::' + $A.k) -Name $A.n -Force; Emit-Result @{ok=$true}`, { args: { k: it.key, n: it.valueName } });
  } else if (it.kind === 'folder') {
    const fs = require('fs'); const path = require('path');
    const bk = path.join(b.dir, path.basename(it.file));
    fs.copyFileSync(it.file, bk); fs.unlinkSync(it.file);
    data.files = [{ original: it.file, backup: bk }];
  } else throw new Error('Tipo non eliminabile');
  undo.add({ id: b.id, backupDir: b.dir, type: 'startup-delete', title: `Elemento di avvio eliminato: ${it.name}`, detail: it.command, data });
  return { ok: true };
}

undo.registerHandler('startup', async (e) => { await ps.json(SET_STARTUP, { args: { items: [e.data.item] } }); });

// ---------------- Sleep mode ----------------
function sleepState() { return store.load('sleep', { programs: {} }); }

async function listPrograms(opts = {}, ctx = {}) {
  const r = await rawScan(false, ctx);
  if (ctx.progress) ctx.progress({ percent: 80, label: 'Analisi e organizzazione…' });
  const state = sleepState();
  const groups = {};
  const winDir = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  for (const it of r.items) {
    if (!it.exe) continue;
    const exeL = String(it.exe).toLowerCase();
    if (exeL.startsWith(winDir)) continue;
    if (/novatune/i.test(exeL)) continue;
    const key = (it.product && it.company) ? (it.company + '|' + it.product).toLowerCase() : folderOf(it.exe);
    if (!groups[key]) groups[key] = { key, name: it.product || it.description || it.name, company: it.company || '', folder: folderOf(it.exe), components: [], mem: 0, size: 0 };
    groups[key].components.push(it);
    groups[key].size = Math.max(groups[key].size, it.size || 0);
  }
  for (const g of Object.values(groups)) {
    const procs = r.procs.filter((p) => p.path.toLowerCase().startsWith(g.folder));
    g.mem = procs.reduce((a, p) => a + p.mem, 0);
    g.running = procs.length;
    g.impact = impact(g.size, g.mem);
    const st = state.programs[g.key];
    const active = g.components.filter((c) => c.enabled);
    if (st && st.sleeping) g.status = active.length ? 'awake-temp' : 'sleeping';
    else if (!active.length) g.status = 'disabled';
    else g.status = 'awake';
    g.counts = { run: 0, folder: 0, task: 0, service: 0 };
    g.components.forEach((c) => g.counts[c.kind]++);
  }
  const list = Object.values(groups).filter((g) => g.status !== 'disabled' || (state.programs[g.key] && state.programs[g.key].sleeping)).sort((a, b) => ({ high: 0, medium: 1, low: 2, none: 3 }[a.impact] - { high: 0, medium: 1, low: 2, none: 3 }[b.impact]));
  return { programs: list, sleepingCount: list.filter((g) => g.status === 'sleeping').length };
}

async function sleep(opts) {
  // opts: { programs: [group objects from listPrograms] }
  const state = sleepState();
  let n = 0;
  for (const g of opts.programs) {
    const comps = g.components.filter((c) => c.enabled);
    if (!comps.length) continue;
    const items = comps.map((c) => Object.assign({}, c, { enable: false }));
    await ps.json(SET_STARTUP, { args: { items, stop: true, killPaths: opts.killProcesses && g.folder && g.folder.length > 12 ? [g.folder] : null } });
    state.programs[g.key] = { sleeping: true, name: g.name, date: new Date().toISOString(), components: comps.map((c) => Object.assign({}, c, { enable: true, restoreMode: c.kind === 'service' ? (c.startMode === 'Auto' ? 'Auto' : c.startMode) : undefined })) };
    undo.add({ type: 'sleep', title: `${g.name} è stato sospeso`, detail: comps.map((c) => `${c.location}: ${c.name}`).join('\n'), data: { key: g.key } });
    n++;
  }
  store.save('sleep');
  store.addStat('programsSleeping', n, { type: 'sleep', items: n });
  return { slept: n };
}

async function wake(opts) {
  const state = sleepState();
  let n = 0;
  for (const key of opts.keys) {
    const st = state.programs[key];
    if (!st) continue;
    await ps.json(SET_STARTUP, { args: { items: st.components } });
    delete state.programs[key];
    n++;
  }
  store.save('sleep');
  return { woken: n };
}

undo.registerHandler('sleep', async (e) => { await wake({ keys: [e.data.key] }); });

// ---------------- Running processes (task view) ----------------
async function processes() {
  const r = await ps.json(`
$cpu = @{}
try { Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { $cpu[[int]$_.IDProcess] = [int]$_.PercentProcessorTime } } catch {}
$cores = [Environment]::ProcessorCount
$list = Get-Process | Where-Object { $_.Id -ne 0 -and $_.Id -ne 4 } | ForEach-Object {
  $d = ''; try { $d = $_.MainModule.FileVersionInfo.FileDescription } catch {}
  @{ id = $_.Id; name = $_.ProcessName; path = $_.Path; mem = [int64]$_.WorkingSet64; cpu = [math]::Round(($cpu[$_.Id] / $cores), 1); desc = $d; title = $_.MainWindowTitle } }
Emit-Result @($list)`, { timeout: 60000 });
  return ps.arr(r).sort((a, b) => b.mem - a.mem);
}

async function killProcess(opts) {
  const r = await ps.exec('taskkill.exe', ['/PID', String(opts.pid), '/F', '/T']);
  return { ok: r.code === 0, msg: r.stdout + r.stderr };
}

module.exports = { listStartup, setStartup, deleteStartup, listPrograms, sleep, wake, processes, killProcess };
