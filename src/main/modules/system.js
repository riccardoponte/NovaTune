// System info, automatic maintenance, scheduler, context menu, Windows integration
const path = require('path');
const fs = require('fs');
const os = require('os');
const ps = require('../ps');
const store = require('../store');

async function info() {
  const r = await ps.json(`
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$bb = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
Emit-Result @{
  os = $os.Caption; version = $cv.DisplayVersion; build = [string]$os.BuildNumber + '.' + [string]$cv.UBR; arch = $os.OSArchitecture
  installDate = $os.InstallDate.ToString('o'); lastBoot = $os.LastBootUpTime.ToString('o')
  computer = $cs.Name; manufacturer = $cs.Manufacturer; model = $cs.Model
  cpu = $cpu.Name.Trim(); cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; cpuLoad = $cpu.LoadPercentage
  ram = [int64]$cs.TotalPhysicalMemory; ramFree = [int64]$os.FreePhysicalMemory * 1024
  gpu = $gpu; board = ($bb.Manufacturer + ' ' + $bb.Product); bios = ($bios.SMBIOSBIOSVersion)
  sysDrive = $env:SystemDrive; diskSize = [int64]$disk.Size; diskFree = [int64]$disk.FreeSpace
}`, { timeout: 60000 });
  return r;
}

function live() {
  const cpus = os.cpus();
  return { ram: os.totalmem(), ramFree: os.freemem(), uptime: os.uptime(), cpus: cpus.map((c) => c.times) };
}

// ---------------- scheduling ----------------
const TASK_NAME = 'NovaTune PC Suite - Manutenzione automatica';
const DRIVER_TASK = 'NovaTune PC Suite - Controllo driver';

async function applySchedule() {
  const s = store.settings();
  const exe = process.execPath;
  const isDev = !require('electron').app.isPackaged;
  const args = isDev ? `"${path.resolve(__dirname, '..', '..', '..')}" --auto-maintenance` : '--auto-maintenance';
  const am = s.autoMaintenance;
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const res = await ps.json(`
$name = $A.name
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
if ($A.enabled) {
  $act = New-ScheduledTaskAction -Execute $A.exe -Argument $A.args
  $t = [datetime]::ParseExact($A.time, 'HH:mm', $null)
  switch ($A.freq) {
    'daily'   { $trg = New-ScheduledTaskTrigger -Daily -At $t }
    'weekly'  { $trg = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $A.dow -At $t }
    'monthly' { $trg = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek $A.dow -At $t }
  }
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfIdle:$false -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $pr = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -RunLevel Highest -LogonType Interactive
  Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $pr -Force | Out-Null
}
$dname = $A.dname
Unregister-ScheduledTask -TaskName $dname -Confirm:$false -ErrorAction SilentlyContinue
if ($A.driver -ne 'off') {
  $act = New-ScheduledTaskAction -Execute $A.exe -Argument ($A.args -replace '--auto-maintenance','--driver-check')
  if ($A.driver -eq 'daily') { $trg = New-ScheduledTaskTrigger -Daily -At '10:00' } else { $trg = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '10:00' }
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries
  $pr = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -RunLevel Highest -LogonType Interactive
  Register-ScheduledTask -TaskName $dname -Action $act -Trigger $trg -Settings $set -Principal $pr -Force | Out-Null
}
Emit-Result @{ ok = $true }`, { args: { name: TASK_NAME, dname: DRIVER_TASK, enabled: !!am.enabled, exe, args, time: am.time || '12:00', freq: am.frequency || 'weekly', dow: days[am.day || 1], driver: s.driverScanSchedule || 'off' } });
  return res;
}

async function setStartWithWindows(enabled) {
  const exe = process.execPath;
  await ps.json(`
$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
if ($A.on) { New-ItemProperty -Path $k -Name 'NovaTune PC Suite' -Value ('"' + $A.exe + '" --tray') -PropertyType String -Force | Out-Null }
else { Remove-ItemProperty -Path $k -Name 'NovaTune PC Suite' -ErrorAction SilentlyContinue }
Emit-Result @{ok=$true}`, { args: { on: !!enabled, exe } });
}

async function setContextMenu(enabled) {
  const exe = process.execPath;
  const isDev = !require('electron').app.isPackaged;
  const cmd = isDev ? `"${exe}" "${path.resolve(__dirname, '..', '..', '..')}" --shred "%1"` : `"${exe}" --shred "%1"`;
  // reg.exe is used because "*" is a wildcard for PowerShell registry paths
  for (const c of ['HKCU\\Software\\Classes\\*\\shell\\NovaTuneShred', 'HKCU\\Software\\Classes\\Directory\\shell\\NovaTuneShred']) {
    if (enabled) {
      await ps.exec('reg.exe', ['add', c, '/ve', '/d', 'Distruggi definitivamente con NovaTune', '/f']);
      await ps.exec('reg.exe', ['add', c, '/v', 'Icon', '/d', exe, '/f']);
      await ps.exec('reg.exe', ['add', c + '\\command', '/ve', '/d', cmd, '/f']);
    } else {
      await ps.exec('reg.exe', ['delete', c, '/f']);
    }
  }
}

module.exports = { info, live, applySchedule, setStartWithWindows, setContextMenu };
