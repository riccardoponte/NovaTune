// Driver Updater: inventory, outdated/missing driver detection (Windows Update catalog), install, backup & restore
const fs = require('fs');
const path = require('path');
const os = require('os');
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');

let lastUpdates = [];

async function inventory(opts = {}, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 10, label: 'Analisi dei dispositivi installati…' });
  const r = await ps.json(`
$drv = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | ForEach-Object {
  $d = $null; if ($_.DriverDate) { try { $d = ([datetime]$_.DriverDate).ToString('yyyy-MM-dd') } catch {} }
  @{ name = $_.DeviceName; cls = [string]$_.DeviceClass; manufacturer = [string]$_.Manufacturer; provider = [string]$_.DriverProviderName; version = [string]$_.DriverVersion; date = $d; inf = [string]$_.InfName; deviceId = [string]$_.DeviceID; hwid = [string]$_.HardWareID; signed = [bool]$_.IsSigned; friendly = [string]$_.FriendlyName } })
$bad = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | ForEach-Object {
  @{ name = [string]$(if ($_.Name) { $_.Name } else { $_.DeviceID }); deviceId = [string]$_.DeviceID; code = [int]$_.ConfigManagerErrorCode; cls = [string]$_.PNPClass; hwids = @($_.HardwareID) } })
Emit-Result @{ drivers = $drv; problems = $bad }`, { timeout: 300000 });
  const drivers = ps.arr(r.drivers);
  const problems = ps.arr(r.problems);
  const now = Date.now();
  for (const d of drivers) {
    d.ageYears = d.date ? Math.floor((now - new Date(d.date).getTime()) / (365.25 * 86400000)) : null;
    d.thirdParty = /^oem\d+\.inf$/i.test(d.inf);
  }
  return { drivers, problems };
}

const CM_CODES = { 1: 'Dispositivo non configurato correttamente', 3: 'Driver danneggiato', 10: 'Impossibile avviare il dispositivo', 12: 'Risorse insufficienti', 14: 'Riavvio necessario', 18: 'Reinstallare i driver', 19: 'Configurazione del registro danneggiata', 22: 'Dispositivo disattivato', 24: 'Dispositivo non presente o non funzionante', 28: 'Driver non installato', 31: 'Il dispositivo non funziona correttamente', 32: 'Servizio driver disattivato', 37: 'Inizializzazione del driver non riuscita', 39: 'Driver danneggiato o mancante', 43: 'Il dispositivo ha segnalato problemi', 45: 'Dispositivo non collegato', 48: 'Driver bloccato per problemi noti', 52: 'Firma digitale del driver non verificabile' };

async function scan(opts = {}, ctx = {}) {
  const inv = await inventory(opts, ctx);
  if (ctx.progress) ctx.progress({ percent: 35, label: 'Ricerca di driver aggiornati nel catalogo Windows Update… (può richiedere alcuni minuti)' });
  const wu = await ps.json(`
try {
  $s = New-Object -ComObject Microsoft.Update.Session
  $s.ClientApplicationID = 'NovaTune PC Suite'
  $searcher = $s.CreateUpdateSearcher()
  $searcher.Online = $true
  $res = $searcher.Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
  $list = @(foreach ($u in $res.Updates) {
    $d = $null; try { $d = ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } catch {}
    @{ id = $u.Identity.UpdateID; rev = $u.Identity.RevisionNumber; title = $u.Title; hwid = [string]$u.DriverHardwareID; model = [string]$u.DriverModel; manufacturer = [string]$u.DriverManufacturer; provider = [string]$u.DriverProvider; cls = [string]$u.DriverClass; date = $d; size = [int64]$u.MaxDownloadSize; description = $u.Description; reboot = [int]$u.InstallationBehavior.RebootBehavior; eula = [bool]$u.EulaAccepted; downloaded = [bool]$u.IsDownloaded }
  })
  Emit-Result @{ ok = $true; updates = $list }
} catch { Emit-Result @{ ok = $false; error = $_.Exception.Message; updates = @() } }`, { timeout: 1200000 });
  const ignored = new Set(store.settings().ignored.drivers || []);
  const updates = ps.arr(wu.updates).map((u) => {
    const hw = (u.hwid || '').toLowerCase();
    const dev = inv.drivers.find((d) => d.hwid && d.hwid.toLowerCase() === hw) || inv.drivers.find((d) => hw && d.deviceId && d.deviceId.toLowerCase().startsWith(hw));
    const prob = inv.problems.find((p) => ps.arr(p.hwids).some((h) => String(h).toLowerCase() === hw));
    const verM = (u.title || '').match(/(\d+\.\d+\.\d+[\.\d]*)/);
    return Object.assign(u, {
      newVersion: verM ? verM[1] : '',
      device: dev ? dev.name : (prob ? prob.name : u.model),
      currentVersion: dev ? dev.version : '',
      currentDate: dev ? dev.date : null,
      missing: !dev && !!prob,
      ignored: ignored.has(u.id)
    });
  });
  lastUpdates = updates;
  const problems = inv.problems.map((p) => Object.assign(p, { reason: CM_CODES[p.code] || ('Codice errore ' + p.code), hasUpdate: updates.some((u) => ps.arr(p.hwids).some((h) => String(h).toLowerCase() === (u.hwid || '').toLowerCase())) }));
  const meta = store.load('drivers-meta', {});
  meta.lastScan = new Date().toISOString();
  meta.lastCount = updates.filter((u) => !u.ignored).length;
  store.save('drivers-meta');
  return { updates, problems, drivers: inv.drivers, wuError: wu.ok ? null : wu.error, lastScan: meta.lastScan };
}

async function install(opts = {}, ctx = {}) {
  const ids = opts.ids || lastUpdates.filter((u) => !u.ignored).map((u) => u.id);
  if (!ids.length) return { results: [] };
  if (store.settings().createRestorePoint) {
    if (ctx.progress) ctx.progress({ percent: 2, label: 'Creazione di un punto di ripristino…' });
    const rp = await undo.createRestorePoint('NovaTune - Prima dell\'aggiornamento driver');
    if (rp && rp.ok) undo.add({ type: 'restorepoint', title: 'Punto di ripristino creato prima dell\'aggiornamento dei driver', detail: 'Usa Ripristino configurazione di sistema per annullare.', data: {} });
  }
  // backup current drivers of affected devices first
  if (ctx.progress) ctx.progress({ percent: 5, label: 'Backup dei driver attuali…' });
  try { await backup({ label: 'Prima dell\'aggiornamento' }); } catch (e) {}
  const r = await ps.run(`
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'NovaTune PC Suite'
$searcher = $s.CreateUpdateSearcher()
$results = @()
$i = 0
foreach ($id in $A) {
  $i++
  $pct = [int](($i - 1) * 100 / $A.Count)
  try {
    Emit-Progress @{ percent = $pct; label = "Ricerca del driver $i di $($A.Count)…"; id = $id }
    $res = $searcher.Search("UpdateID='$id'")
    if ($res.Updates.Count -eq 0) { $results += @{ id = $id; ok = $false; error = 'Aggiornamento non più disponibile' }; continue }
    $coll = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $res.Updates) { if (-not $u.EulaAccepted) { $u.AcceptEula() }; [void]$coll.Add($u) }
    Emit-Progress @{ percent = $pct; label = "Download: $($res.Updates.Item(0).Title)"; id = $id }
    $dl = $s.CreateUpdateDownloader(); $dl.Updates = $coll; $dr = $dl.Download()
    Emit-Progress @{ percent = $pct; label = "Installazione: $($res.Updates.Item(0).Title)"; id = $id }
    $inst = $s.CreateUpdateInstaller(); $inst.Updates = $coll; $ir = $inst.Install()
    $results += @{ id = $id; ok = ($ir.ResultCode -eq 2 -or $ir.ResultCode -eq 3); code = [int]$ir.ResultCode; reboot = [bool]$ir.RebootRequired; hresult = $ir.HResult }
  } catch { $results += @{ id = $id; ok = $false; error = $_.Exception.Message } }
}
Emit-Result @($results)`, { args: ids, onProgress: (p) => ctx.progress && ctx.progress(Object.assign(p, { percent: 10 + Math.round(p.percent * 0.9) })), timeout: 3600000 });
  const results = ps.arr(r.result);
  const okN = results.filter((x) => x.ok).length;
  store.addStat('driversUpdated', okN, { type: 'drivers', items: okN });
  return { results, reboot: results.some((x) => x.reboot) };
}

function backupRoot() {
  const d = path.join(os.homedir(), 'Documents', 'NovaTune Driver Backup');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function backup(opts = {}, ctx = {}) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(opts.root || backupRoot(), stamp + (opts.label ? ' ' + opts.label.replace(/[\\/:*?"<>|]/g, '') : ''));
  fs.mkdirSync(dir, { recursive: true });
  if (ctx.progress) ctx.progress({ percent: 30, label: 'Esportazione dei driver di terze parti…' });
  const target = opts.inf ? [opts.inf] : ['*'];
  const r = await ps.exec(path.join(process.env.SystemRoot, 'System32', 'pnputil.exe'), ['/export-driver', target[0], dir], { timeout: 1800000 });
  let count = 0;
  try { count = fs.readdirSync(dir).length; } catch (e) {}
  if (!count) {
    // fallback for older Windows 10 builds
    await ps.run(`Export-WindowsDriver -Online -Destination $A.d | Out-Null; Emit-Result @{ok=$true}`, { args: { d: dir }, timeout: 1800000 });
    try { count = fs.readdirSync(dir).length; } catch (e) {}
  }
  return { ok: count > 0, dir, count, log: r.stdout.slice(-1000) };
}

function listBackups() {
  const root = backupRoot();
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const d = path.join(root, e.name);
    let n = 0; try { n = fs.readdirSync(d).length; } catch (er) {}
    return { name: e.name, dir: d, count: n, date: fs.statSync(d).mtime.toISOString() };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

async function restore(opts, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 20, label: 'Ripristino dei driver dal backup…' });
  const r = await ps.exec(path.join(process.env.SystemRoot, 'System32', 'pnputil.exe'), ['/add-driver', path.join(opts.dir, '*.inf'), '/subdirs', '/install'], { timeout: 3600000 });
  return { ok: r.code === 0 || r.code === 3010, reboot: r.code === 3010, log: r.stdout.slice(-2000) };
}

async function deleteBackup(opts) {
  if (!opts.dir.startsWith(backupRoot())) throw new Error('Percorso non valido');
  fs.rmSync(opts.dir, { recursive: true, force: true });
  return { ok: true };
}

async function rescanDevices() {
  const r = await ps.exec(path.join(process.env.SystemRoot, 'System32', 'pnputil.exe'), ['/scan-devices']);
  return { ok: r.code === 0 };
}

module.exports = { inventory, scan, install, backup, listBackups, restore, deleteBackup, rescanDevices, backupRoot };
