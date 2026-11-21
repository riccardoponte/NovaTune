// Disk optimizer: analysis, defrag (HDD) / TRIM (SSD), error check, health
const { spawn } = require('child_process');
const path = require('path');
const ps = require('../ps');
const store = require('../store');

async function list() {
  const r = await ps.json(`
$pd = @{}
Get-PhysicalDisk | ForEach-Object { $pd[[string]$_.DeviceId] = $_ }
$out = @()
Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -in @('Fixed','Removable') -and $_.Size -gt 0 } | Sort-Object DriveLetter | ForEach-Object {
  $v = $_; $media = 'Unknown'; $bus = ''; $model = ''; $health = [string]$v.HealthStatus; $rel = $null
  try {
    $part = Get-Partition -DriveLetter $v.DriveLetter -ErrorAction Stop
    $disk = Get-Disk -Number $part.DiskNumber
    $p = $pd[[string]$part.DiskNumber]
    if ($p) { $media = [string]$p.MediaType; $bus = [string]$p.BusType; $model = [string]$p.FriendlyName; $health = [string]$p.HealthStatus
      try { $c = $p | Get-StorageReliabilityCounter -ErrorAction Stop; $rel = @{ temperature = $c.Temperature; wear = $c.Wear; powerOnHours = $c.PowerOnHours; readErrors = $c.ReadErrorsTotal; writeErrors = $c.WriteErrorsTotal } } catch {} }
    if ($media -eq 'Unspecified' -and $disk.Model -match 'SSD|NVMe') { $media = 'SSD' }
    if ($bus -eq 'NVMe') { $media = 'SSD' }
    if ($bus -eq 'SD' -or $bus -eq 'MMC') { $media = 'SD' }
    if ($bus -eq 'USB' -and $media -eq 'Unspecified') { $media = 'Flash' }
  } catch {}
  $out += @{ letter = [string]$v.DriveLetter; label = $v.FileSystemLabel; fs = $v.FileSystem; size = [int64]$v.Size; free = [int64]$v.SizeRemaining; media = $media; bus = $bus; model = $model; health = $health; driveType = [string]$v.DriveType; reliability = $rel; system = ($v.DriveLetter + ':') -eq $env:SystemDrive }
}
Emit-Result @($out)`, { timeout: 120000 });
  const meta = store.load('disks', {});
  return ps.arr(r).map((d) => Object.assign(d, meta[d.letter] || {}));
}

async function analyze(opts) {
  const r = await ps.json(`
$v = Get-CimInstance Win32_Volume -Filter ("DriveLetter='" + $A.letter + ":'")
if (-not $v) { Emit-Result @{ ok = $false; error = 'Volume non trovato' }; return }
$res = Invoke-CimMethod -InputObject $v -MethodName DefragAnalysis
$a = $res.DefragAnalysis
Emit-Result @{ ok = ($res.ReturnValue -eq 0); code = $res.ReturnValue; recommended = [bool]$res.DefragRecommended; filePercent = [int]$a.FilePercentFragmentation; totalPercent = [int]$a.TotalPercentFragmentation; freeSpacePercent = [int]$a.FreeSpacePercentFragmentation; fragmentedFiles = [int64]$a.TotalFragmentedFiles; totalFiles = [int64]$a.TotalFiles }`, { args: { letter: opts.letter }, timeout: 3600000 });
  const meta = store.load('disks', {});
  meta[opts.letter] = Object.assign(meta[opts.letter] || {}, { lastAnalysis: new Date().toISOString(), fragmentation: r.totalPercent });
  store.save('disks');
  return r;
}

/** Optimize: defrag (HDD) or retrim (SSD). Streams percent from defrag.exe */
function optimize(opts, ctx = {}) {
  return new Promise((resolve) => {
    const args = [opts.letter + ':', opts.media === 'SSD' ? '/L' : '/O', '/U', '/V'];
    if (opts.media !== 'SSD' && opts.full) args[1] = '/D';
    const child = spawn(path.join(process.env.SystemRoot, 'System32', 'defrag.exe'), args, { windowsHide: true });
    let out = '';
    const onData = (d) => {
      const s = d.toString('latin1');
      out += s;
      const m = s.match(/(\d{1,3})(?:[.,]\d+)?\s?%/g);
      if (m && ctx.progress) {
        const pct = parseInt(m[m.length - 1], 10);
        if (pct >= 0 && pct <= 100) ctx.progress({ percent: pct, label: opts.media === 'SSD' ? 'Ottimizzazione (TRIM) in corso…' : 'Deframmentazione in corso…' });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      const meta = store.load('disks', {});
      meta[opts.letter] = Object.assign(meta[opts.letter] || {}, { lastOptimized: new Date().toISOString() });
      if (code === 0 && opts.media !== 'SSD') meta[opts.letter].fragmentation = 0;
      store.save('disks');
      store.addStat('defragRuns', 1, { type: 'defrag', items: 1 });
      resolve({ ok: code === 0, code, output: out.slice(-3000) });
    });
  });
}

async function checkErrors(opts) {
  return ps.json(`
try { $r = Repair-Volume -DriveLetter $A.letter -Scan -ErrorAction Stop; Emit-Result @{ ok = $true; result = [string]$r } }
catch { Emit-Result @{ ok = $false; error = $_.Exception.Message } }`, { args: { letter: opts.letter }, timeout: 3600000 });
}

async function fixErrors(opts) {
  return ps.json(`
try {
  $r = Repair-Volume -DriveLetter $A.letter -SpotFix -ErrorAction Stop
  Emit-Result @{ ok = $true; result = [string]$r; reboot = $false }
} catch {
  try { $r = Repair-Volume -DriveLetter $A.letter -OfflineScanAndFix -ErrorAction Stop; Emit-Result @{ ok = $true; result = [string]$r; reboot = $true } }
  catch { Emit-Result @{ ok = $false; error = $_.Exception.Message } }
}`, { args: { letter: opts.letter }, timeout: 3600000 });
}

module.exports = { list, analyze, optimize, checkErrors, fixErrors };
