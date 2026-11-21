// Undo Center: every change made by the suite is recorded here and can be reverted
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const ps = require('../ps');

const handlers = {};

function entries() { return store.load('undo', []); }

function newBackupDir() {
  const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const d = store.dir('backups', id);
  fs.mkdirSync(d, { recursive: true });
  return { id, dir: d };
}

function add(entry) {
  const list = entries();
  const e = Object.assign({ id: entry.id || (Date.now().toString(36) + crypto.randomBytes(3).toString('hex')), date: new Date().toISOString(), undone: false }, entry);
  list.unshift(e);
  store.save('undo', list);
  return e;
}

function registerHandler(type, fn) { handlers[type] = fn; }

/** Export registry keys to .reg files (for undo). keys: ['HKCU\\Software\\X', ...] */
async function exportKeys(keys, dir) {
  const files = [];
  let i = 0;
  for (const k of keys) {
    const f = path.join(dir, `reg_${i++}.reg`);
    const r = await ps.exec('reg.exe', ['export', k, f, '/y']);
    if (r.code === 0 && fs.existsSync(f)) files.push(f);
  }
  return files;
}

/** Backup individual registry values: [{key:'HKLM\\..', name:'X'}] -> [{key,name,exists,kind,value}] */
async function snapshotValues(values) {
  return ps.json(`
$out = @()
foreach ($v in $A) {
  $p = 'Registry::' + $v.key
  $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
  if ($item -and ($item.GetValueNames() -contains $v.name)) {
    $kind = $item.GetValueKind($v.name).ToString()
    $val = $item.GetValue($v.name, $null, 'DoNotExpandEnvironmentNames')
    if ($kind -eq 'Binary') { $val = [Convert]::ToBase64String([byte[]]$val) }
    $out += @{ key = $v.key; name = $v.name; exists = $true; kind = $kind; value = $val }
  } else { $out += @{ key = $v.key; name = $v.name; exists = $false } }
}
Emit-Result @($out)`, { args: values });
}

async function restoreValues(values) {
  return ps.json(`
foreach ($v in $A) {
  $p = 'Registry::' + $v.key
  if ($v.exists) {
    if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
    $val = $v.value
    if ($v.kind -eq 'Binary') { $val = [Convert]::FromBase64String($v.value) }
    elseif ($v.kind -eq 'DWord') { $val = [int64]$v.value; if ($val -gt [int32]::MaxValue) { $val = [int32]($val - 4294967296) } else { $val = [int32]$val } }
    elseif ($v.kind -eq 'QWord') { $val = [int64]$v.value }
    elseif ($v.kind -eq 'MultiString') { $val = [string[]]$v.value }
    New-ItemProperty -LiteralPath $p -Name $v.name -Value $val -PropertyType $v.kind -Force | Out-Null
  } else {
    Remove-ItemProperty -LiteralPath $p -Name $v.name -Force -ErrorAction SilentlyContinue
  }
}
Emit-Result @{ ok = $true }`, { args: values });
}

async function restore(id) {
  const list = entries();
  const e = list.find((x) => x.id === id);
  if (!e) throw new Error('Backup non trovato');
  if (e.undone) return { ok: true };
  const d = e.data || {};
  if (d.regFiles) {
    for (const f of d.regFiles) await ps.exec('reg.exe', ['import', f]);
  }
  if (d.files) {
    for (const it of d.files) {
      try {
        fs.mkdirSync(path.dirname(it.original), { recursive: true });
        fs.copyFileSync(it.backup, it.original);
      } catch (err) { /* ignore single failures */ }
    }
  }
  if (d.values) await restoreValues(d.values);
  if (handlers[e.type]) await handlers[e.type](e);
  e.undone = true;
  e.undoneDate = new Date().toISOString();
  store.save('undo');
  return { ok: true };
}

function list() {
  purge();
  return entries();
}

function remove(id) {
  const list = entries();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) {
    const [e] = list.splice(i, 1);
    if (e.backupDir) { try { fs.rmSync(e.backupDir, { recursive: true, force: true }); } catch (err) {} }
    store.save('undo');
  }
  return { ok: true };
}

function purge() {
  const days = store.settings().undoRetentionDays;
  if (!days) return;
  const limit = Date.now() - days * 86400000;
  const list = entries();
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (new Date(list[i].date).getTime() < limit) {
      if (list[i].backupDir) { try { fs.rmSync(list[i].backupDir, { recursive: true, force: true }); } catch (err) {} }
      list.splice(i, 1);
      changed = true;
    }
  }
  if (changed) store.save('undo');
}

// --- System restore points -------------------------------------------------
async function restorePoints() {
  return ps.json(`
$rp = @(Get-ComputerRestorePoint | ForEach-Object {
  @{ seq = $_.SequenceNumber; description = $_.Description; type = $_.RestorePointType; date = ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationTime)).ToString('o') } })
$enabled = $true
try { $c = Get-CimInstance -Namespace root/default -ClassName SystemRestoreConfig; } catch {}
Emit-Result @{ points = $rp }`);
}

async function createRestorePoint(description) {
  return ps.json(`
# Allow more than one restore point every 24h
New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name SystemRestorePointCreationFrequency -Value 0 -PropertyType DWord -Force | Out-Null
$drive = $env:SystemDrive + '\\'
try { Enable-ComputerRestore -Drive $drive -ErrorAction Stop } catch {}
try { Checkpoint-Computer -Description $A.d -RestorePointType MODIFY_SETTINGS -ErrorAction Stop; Emit-Result @{ ok = $true } }
catch { Emit-Result @{ ok = $false; error = $_.Exception.Message } }`, { args: { d: description || 'NovaTune PC Suite' }, timeout: 300000 });
}

async function openSystemRestore() {
  await ps.exec('rstrui.exe', []);
  return { ok: true };
}

module.exports = { add, list, restore, remove, registerHandler, newBackupDir, exportKeys, snapshotValues, restoreValues, restorePoints, createRestorePoint, openSystemRestore, purge };
