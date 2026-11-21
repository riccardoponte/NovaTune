// Fix Problems: Windows, security and privacy settings that put the PC at risk
const ps = require('../ps');
const store = require('../store');
const undo = require('./undo');

const HKLM = 'HKEY_LOCAL_MACHINE', HKCU = 'HKEY_CURRENT_USER';
const num = (v) => (v == null || v === '' ? null : Number(v));

// kind 'reg': {key,name,isBad(v), fix:{value,type}|{delete:true}}
const CHECKS = [
  { id: 'uac', group: 'security', title: 'Controllo account utente', ok: 'Il PC è protetto da modifiche indesiderate', bad: 'Il PC è esposto a modifiche indesiderate', tip: 'Mantieni attivato Controllo account utente per impedire le modifiche indesiderate.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'EnableLUA', isBad: (v) => num(v) === 0, fix: { value: 1, type: 'DWord' }, reboot: true },
  { id: 'uacPrompt', group: 'security', title: 'Notifiche di Controllo account utente', ok: 'Riceverai una richiesta prima delle modifiche al sistema', bad: 'Le app possono modificare il sistema senza chiedere conferma', tip: 'Ripristina il livello predefinito di notifica di UAC.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'ConsentPromptBehaviorAdmin', isBad: (v) => num(v) === 0, fix: { value: 5, type: 'DWord' } },
  { id: 'firewall', group: 'security', title: 'Windows Firewall', ok: 'Il firewall è attivo su tutte le reti', bad: 'Il firewall è disattivato su una o più reti', tip: 'Attiva il firewall per bloccare gli accessi non autorizzati dalla rete.', kind: 'custom' },
  { id: 'antivirus', group: 'security', title: 'Protezione antivirus in tempo reale', ok: 'La protezione antivirus in tempo reale è attiva', bad: 'Nessuna protezione antivirus in tempo reale attiva', tip: 'Attiva la protezione in tempo reale di Microsoft Defender o di un altro antivirus.', kind: 'custom' },
  { id: 'firewallNotify', group: 'security', title: 'Avvisi del firewall', ok: 'Gli avvisi relativi al firewall sono attivati', bad: 'Gli avvisi relativi al firewall sono disattivati', tip: 'Lascia attivata questa impostazione per ricevere avvisi quando la protezione del firewall non è sufficiente.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Security Center', name: 'FirewallDisableNotify', isBad: (v) => num(v) === 1, fix: { delete: true } },
  { id: 'avNotify', group: 'security', title: 'Avvisi antivirus', ok: 'Gli avvisi relativi all\'antivirus sono attivati', bad: 'Gli avvisi relativi all\'antivirus sono disattivati', tip: 'Lascia attivata questa impostazione per ricevere avvisi quando la protezione antivirus non è sufficiente.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Security Center', name: 'AntiVirusDisableNotify', isBad: (v) => num(v) === 1, fix: { delete: true } },
  { id: 'secNotify', group: 'security', title: 'Notifiche di Sicurezza di Windows', ok: 'Le notifiche di Sicurezza di Windows sono attive', bad: 'Le notifiche di Sicurezza di Windows sono disattivate', tip: 'Riattiva le notifiche per sapere quando il PC è a rischio.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Windows Defender Security Center\\Notifications', name: 'DisableNotifications', isBad: (v) => num(v) === 1, fix: { delete: true } },
  { id: 'smartscreen', group: 'security', title: 'SmartScreen', ok: 'SmartScreen controlla app e file scaricati', bad: 'SmartScreen è disattivato', tip: 'SmartScreen ti avvisa prima di eseguire app e file non riconosciuti.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer', name: 'SmartScreenEnabled', isBad: (v) => String(v || '').toLowerCase() === 'off', fix: { value: 'Warn', type: 'String' } },
  { id: 'certs', group: 'security', title: 'Avvisi certificati non validi', ok: 'Gli avvisi relativi ai certificati di sicurezza non validi sono attivati', bad: 'Gli avvisi relativi ai certificati di sicurezza non validi sono disattivati', tip: 'Lascia attivata questa impostazione per assicurarti che i siti Web visitati siano sicuri.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', name: 'WarnonBadCertRecving', isBad: (v) => num(v) === 0, fix: { value: 1, type: 'DWord' } },
  { id: 'remoteRegistry', group: 'privacy', title: 'Accesso di rete al registro', ok: 'Il registro di Windows è nascosto per gli altri utenti', bad: 'Il registro di Windows potrebbe essere visibile per altri utenti', tip: 'Mantieni disattivato l\'accesso di rete per impedire accessi indesiderati al registro.', kind: 'custom' },
  { id: 'driveShares', group: 'privacy', title: 'Accesso di rete ai dischi', ok: 'I dischi rigidi non sono condivisi in rete', bad: 'Un intero disco è condiviso in rete', tip: 'Mantieni disattivato l\'accesso di rete per impedire accessi indesiderati ai file.', kind: 'custom' },
  { id: 'folderShares', group: 'privacy', title: 'Cartelle condivise con tutti', ok: 'I dati privati sono nascosti per gli altri utenti', bad: 'Alcune cartelle sono condivise con "Everyone"', tip: 'Mantieni disattivato l\'accesso condiviso per impedire accessi indesiderati ai file.', kind: 'custom' },
  { id: 'rdp', group: 'security', title: 'Desktop remoto', ok: 'Le connessioni Desktop remoto sono disattivate', bad: 'Il PC accetta connessioni Desktop remoto', tip: 'Disattiva Desktop remoto se non lo usi, per ridurre i rischi di attacchi dalla rete.', kind: 'custom' },
  { id: 'autoplay', group: 'security', title: 'AutoPlay', ok: 'AutoPlay non esegue automaticamente i supporti esterni', bad: 'AutoPlay può avviare automaticamente programmi da chiavette USB', tip: 'Disattiva AutoPlay per evitare che malware si avvii da supporti rimovibili.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers', name: 'DisableAutoplay', isBad: (v) => num(v) !== 1, fix: { value: 1, type: 'DWord' }, optional: true },
  { id: 'fileExt', group: 'security', title: 'Estensioni dei file', ok: 'Le estensioni dei file sono visibili', bad: 'Le estensioni dei file sono nascoste (es. "foto.jpg.exe")', tip: 'Mostra le estensioni per riconoscere i file eseguibili mascherati.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'HideFileExt', isBad: (v) => num(v) !== 0, fix: { value: 0, type: 'DWord' }, optional: true },

  { id: 'autoEndTasks', group: 'windows', title: 'AutoEndTasks di Windows', ok: 'I programmi possono salvare i dati prima dell\'arresto', bad: 'Windows chiude i programmi senza permettere il salvataggio', tip: 'Mantieni disattivato AutoEndTasks di Windows per evitare perdite di dati.', kind: 'reg', key: HKCU + '\\Control Panel\\Desktop', name: 'AutoEndTasks', isBad: (v) => String(v) === '1', fix: { value: '0', type: 'String' } },
  { id: 'killApp', group: 'windows', title: 'Tempo di chiusura dei programmi', ok: 'Il tempo disponibile prima dell\'arresto del sistema è sufficiente per la chiusura dei programmi', bad: 'Il tempo disponibile prima dell\'arresto del sistema potrebbe non essere sufficiente per la chiusura dei programmi', tip: 'Aumenta il limite di tempo per l\'arresto del sistema in modo da concedere tempo sufficiente per la chiusura dei programmi.', kind: 'reg', key: HKCU + '\\Control Panel\\Desktop', name: 'WaitToKillAppTimeout', isBad: (v) => v != null && num(v) < 2000, fix: { value: '5000', type: 'String' } },
  { id: 'killService', group: 'windows', title: 'Tempo di chiusura dei servizi', ok: 'Il tempo disponibile prima dell\'arresto del sistema è sufficiente per la chiusura dei servizi', bad: 'Il tempo disponibile prima dell\'arresto del sistema potrebbe non essere sufficiente per la chiusura dei servizi', tip: 'Aumenta il limite di tempo in modo che i servizi possano chiudersi correttamente.', kind: 'reg', key: HKLM + '\\SYSTEM\\CurrentControlSet\\Control', name: 'WaitToKillServiceTimeout', isBad: (v) => v != null && num(v) < 2000, fix: { value: '5000', type: 'String' } },
  { id: 'wuService', group: 'windows', title: 'Servizio Windows Update', ok: 'Gli aggiornamenti di Windows sono attivati', bad: 'Gli aggiornamenti di Windows sono disattivati', tip: 'Gli aggiornamenti contribuiscono a mantenere la stabilità e la sicurezza del PC.', kind: 'custom' },
  { id: 'autoUpdate', group: 'windows', title: 'Aggiornamenti automatici', ok: 'Gli aggiornamenti automatici di Windows sono attivati', bad: 'Gli aggiornamenti automatici di Windows sono disattivati', tip: 'Lascia attivata questa impostazione per mantenere la stabilità e la sicurezza del PC.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU', name: 'NoAutoUpdate', isBad: (v) => num(v) === 1, fix: { delete: true } },
  { id: 'lastUpdate', group: 'windows', title: 'Ultimo aggiornamento di Windows', ok: 'Windows è stato aggiornato di recente', bad: 'Windows non viene aggiornato da {days} giorni', tip: 'Verifica periodicamente gli aggiornamenti disponibili per mantenere la stabilità e la sicurezza del PC.', kind: 'custom' },
  { id: 'systemRestore', group: 'windows', title: 'Ripristino configurazione di sistema', ok: 'La protezione del sistema è attiva', bad: 'La protezione del sistema è disattivata: non potrai annullare modifiche dannose', tip: 'Attiva Ripristino configurazione di sistema sull\'unità di Windows.', kind: 'custom' },
  { id: 'diskSpace', group: 'windows', title: 'Spazio libero sull\'unità di sistema', ok: 'Lo spazio libero su disco è sufficiente', bad: 'Lo spazio libero sull\'unità di sistema è inferiore al 10%', tip: 'Libera spazio per evitare rallentamenti e problemi con gli aggiornamenti.', kind: 'custom', navigate: 'junk' },

  { id: 'adId', group: 'privacy', title: 'ID pubblicità', ok: 'Le app non possono usare l\'ID pubblicità', bad: 'Le app possono usare l\'ID pubblicità per mostrarti annunci personalizzati', tip: 'Disattiva l\'ID pubblicità per limitare il tracciamento tra le app.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled', isBad: (v) => num(v) !== 0, fix: { value: 0, type: 'DWord' } },
  { id: 'tailored', group: 'privacy', title: 'Esperienze personalizzate', ok: 'Microsoft non usa i dati diagnostici per suggerimenti personalizzati', bad: 'I dati diagnostici vengono usati per esperienze personalizzate', tip: 'Disattiva le esperienze personalizzate basate sui dati diagnostici.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', name: 'TailoredExperiencesWithDiagnosticDataEnabled', isBad: (v) => num(v) !== 0, fix: { value: 0, type: 'DWord' } },
  { id: 'telemetry', group: 'privacy', title: 'Dati di diagnostica', ok: 'Vengono inviati solo i dati di diagnostica obbligatori', bad: 'Windows invia dati di diagnostica facoltativi', tip: 'Limita i dati di diagnostica inviati a Microsoft al minimo richiesto.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowTelemetry', isBad: (v) => v == null || num(v) > 1, fix: { value: 1, type: 'DWord' } },
  { id: 'activity', group: 'privacy', title: 'Cronologia attività', ok: 'La cronologia attività non viene caricata', bad: 'La cronologia delle attività viene inviata a Microsoft', tip: 'Impedisci il caricamento della cronologia delle attività.', kind: 'reg', key: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'UploadUserActivities', isBad: (v) => num(v) !== 0, fix: { value: 0, type: 'DWord' } },
  { id: 'tipsAds', group: 'privacy', title: 'Suggerimenti e annunci in Start', ok: 'Start non mostra app suggerite', bad: 'Start e la schermata di blocco mostrano contenuti promozionali', tip: 'Disattiva i contenuti suggeriti da Microsoft.', kind: 'reg', key: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SystemPaneSuggestionsEnabled', isBad: (v) => num(v) !== 0, fix: { value: 0, type: 'DWord' }, optional: true }
];

const CUSTOM_STATE = `
$o = @{}
$o.firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = [bool]($_.Enabled -eq 'True' -or $_.Enabled -eq 1) } })
$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $s = [int]$_.productState; @{ name = $_.displayName; on = ((($s -shr 12) -band 0xF) -eq 1) } })
$o.av = $av
try { $mp = Get-MpComputerStatus -ErrorAction Stop; $o.defender = @{ rtp = [bool]$mp.RealTimeProtectionEnabled; enabled = [bool]$mp.AntivirusEnabled } } catch { $o.defender = $null }
$rr = Get-CimInstance Win32_Service -Filter "Name='RemoteRegistry'"
$o.remoteRegistry = @{ mode = [string]$rr.StartMode; state = [string]$rr.State }
$wu = Get-CimInstance Win32_Service -Filter "Name='wuauserv'"
$o.wu = @{ mode = [string]$wu.StartMode; state = [string]$wu.State }
$shares = @(Get-SmbShare -Special $false -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^(print\\$|IPC\\$|ADMIN\\$)$' -and $_.Path } | ForEach-Object {
  $acc = @(Get-SmbShareAccess -Name $_.Name -ErrorAction SilentlyContinue | Where-Object { $_.AccountName -match 'Everyone|Tutti|\\\\Jeder|Todos|Tout le monde' -and $_.AccessControlType -eq 'Allow' } | ForEach-Object { @{ account = $_.AccountName; right = [string]$_.AccessRight } })
  @{ name = $_.Name; path = $_.Path; everyone = $acc } })
$o.shares = $shares
$last = $null
try { $s = New-Object -ComObject Microsoft.Update.Session; $h = $s.CreateUpdateSearcher(); $cnt = $h.GetTotalHistoryCount(); if ($cnt -gt 0) { $e = $h.QueryHistory(0, [Math]::Min($cnt, 50)) | Where-Object { $_.ResultCode -eq 2 -or $_.ResultCode -eq 3 } | Sort-Object Date -Descending | Select-Object -First 1; if ($e) { $last = $e.Date } } } catch {}
if (-not $last) { $hf = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1; if ($hf) { $last = $hf.InstalledOn } }
$o.lastUpdateDays = if ($last) { [int]((Get-Date) - $last).TotalDays } else { -1 }
$sr = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -ErrorAction SilentlyContinue)
$o.restore = @{ interval = $sr.RPSessionInterval; disableSR = $sr.DisableSR; policy = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\SystemRestore' -ErrorAction SilentlyContinue).DisableSR }
$sd = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$o.rdp = @{ deny = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -ErrorAction SilentlyContinue).fDenyTSConnections; edition = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID }
$o.disk = @{ size = [int64]$sd.Size; free = [int64]$sd.FreeSpace }
$vals = @()
foreach ($r in $A) { $i = Get-Item -LiteralPath ('Registry::' + $r.key) -ErrorAction SilentlyContinue; $v = $null; if ($i) { $v = $i.GetValue($r.name, $null) }; $vals += @{ id = $r.id; value = $v } }
$o.reg = $vals
Emit-Result $o
`;

function evalCustom(id, s) {
  switch (id) {
    case 'firewall': { const off = ps.arr(s.firewall).filter((p) => !p.enabled); return { bad: off.length > 0, info: off.map((p) => p.name).join(', ') }; }
    case 'antivirus': {
      const av = ps.arr(s.av);
      const any = av.some((a) => a.on) || (s.defender && s.defender.rtp);
      return { bad: !any, info: av.map((a) => a.name + (a.on ? ' (attivo)' : '')).join(', ') };
    }
    case 'remoteRegistry': return { bad: s.remoteRegistry.mode === 'Auto' || s.remoteRegistry.state === 'Running' };
    case 'driveShares': { const d = ps.arr(s.shares).filter((x) => /^[A-Za-z]:\\?$/.test(x.path)); return { bad: d.length > 0, info: d.map((x) => `${x.name} (${x.path})`).join(', '), data: d }; }
    case 'folderShares': { const d = ps.arr(s.shares).filter((x) => ps.arr(x.everyone).length && !/^[A-Za-z]:\\?$/.test(x.path)); return { bad: d.length > 0, info: d.map((x) => `${x.name} (${x.path})`).join(', '), data: d }; }
    case 'wuService': return { bad: s.wu.mode === 'Disabled' };
    case 'lastUpdate': return { bad: s.lastUpdateDays > 30, days: s.lastUpdateDays };
    case 'systemRestore': return { bad: s.restore.interval === 0 || s.restore.disableSR === 1 || s.restore.policy === 1 };
    case 'rdp': return { bad: s.rdp && s.rdp.deny === 0 && !/Core/i.test(s.rdp.edition || '') };
    case 'diskSpace': return { bad: s.disk.size > 0 && s.disk.free / s.disk.size < 0.1, info: Math.round((s.disk.free / s.disk.size) * 100) + '% libero' };
  }
  return { bad: false };
}

let last = null;

async function scan(opts = {}, ctx = {}) {
  if (ctx.progress) ctx.progress({ percent: 30, label: 'Controllo delle impostazioni di Windows…' });
  const regChecks = CHECKS.filter((c) => c.kind === 'reg').map((c) => ({ id: c.id, key: c.key, name: c.name }));
  const s = await ps.json(CUSTOM_STATE, { args: regChecks, timeout: 180000 });
  const ignored = new Set(store.settings().ignored.fixes || []);
  const regVals = {};
  ps.arr(s.reg).forEach((r) => { regVals[r.id] = r.value; });
  const items = CHECKS.map((c) => {
    let r;
    if (c.kind === 'reg') r = { bad: !!c.isBad(regVals[c.id]), value: regVals[c.id] };
    else r = evalCustom(c.id, s);
    const badText = c.bad.replace('{days}', r.days);
    return { id: c.id, group: c.group, title: c.title, text: r.bad ? badText : c.ok, tip: c.tip, bad: r.bad, info: r.info || '', ignored: ignored.has(c.id), optional: !!c.optional, navigate: c.navigate, reboot: !!c.reboot, data: r.data };
  });
  last = { items, state: s };
  return { items, problems: items.filter((i) => i.bad && !i.ignored).length };
}

async function fix(opts = {}) {
  if (!last) await scan();
  const ids = opts.ids || last.items.filter((i) => i.bad && !i.ignored && !i.optional && !i.navigate).map((i) => i.id);
  let fixed = 0; const errors = [];
  for (const id of ids) {
    const c = CHECKS.find((x) => x.id === id);
    const item = last.items.find((x) => x.id === id);
    if (!c || !item) continue;
    try {
      if (c.kind === 'reg') {
        const snap = await undo.snapshotValues([{ key: c.key, name: c.name }]);
        if (c.fix.delete) await undo.restoreValues([{ key: c.key, name: c.name, exists: false }]);
        else await undo.restoreValues([{ key: c.key, name: c.name, exists: true, kind: c.fix.type, value: c.fix.value }]);
        undo.add({ type: 'fix', title: `${c.title}: ${c.ok}`, detail: c.key + '\\' + c.name, data: { values: ps.arr(snap) } });
      } else {
        const res = await fixCustom(c.id, item, last.state);
        undo.add({ type: 'fix-custom', title: `${c.title}: ${c.ok}`, detail: item.info || '', data: { id: c.id, prev: res } });
      }
      fixed++;
    } catch (e) { errors.push({ id, error: String(e.message || e) }); }
  }
  store.addStat('problemsFixed', fixed, { type: 'fixes', items: fixed });
  last = null;
  return { fixed, errors };
}

async function fixCustom(id, item, s) {
  switch (id) {
    case 'firewall': await ps.json(`Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True; Emit-Result @{ok=$true}`); return { profiles: ps.arr(s.firewall) };
    case 'antivirus': await ps.json(`try { Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop } catch {}; Start-Process 'windowsdefender://threat'; Emit-Result @{ok=$true}`); return {};
    case 'remoteRegistry': await ps.json(`Stop-Service RemoteRegistry -Force; & sc.exe config RemoteRegistry start= disabled | Out-Null; Emit-Result @{ok=$true}`); return { mode: s.remoteRegistry.mode };
    case 'driveShares': await ps.json(`foreach ($n in $A) { Remove-SmbShare -Name $n -Force }; Emit-Result @{ok=$true}`, { args: item.data.map((x) => x.name) }); return { shares: item.data };
    case 'folderShares': await ps.json(`foreach ($sh in $A) { foreach ($a in $sh.everyone) { Revoke-SmbShareAccess -Name $sh.name -AccountName $a.account -Force | Out-Null } }; Emit-Result @{ok=$true}`, { args: item.data }); return { shares: item.data };
    case 'wuService': await ps.json(`& sc.exe config wuauserv start= demand | Out-Null; Start-Service wuauserv; Emit-Result @{ok=$true}`); return { mode: 'Disabled' };
    case 'lastUpdate': await ps.json(`Start-Process 'ms-settings:windowsupdate'; Start-Process "$env:windir\\System32\\UsoClient.exe" -ArgumentList 'StartInteractiveScan' -WindowStyle Hidden; Emit-Result @{ok=$true}`); return {};
    case 'rdp': await ps.json(`Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1; Emit-Result @{ok=$true}`); return {};
    case 'systemRestore': await ps.json(`Remove-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\SystemRestore' -Name DisableSR -Force; Enable-ComputerRestore -Drive ($env:SystemDrive + '\\'); & vssadmin.exe resize shadowstorage /for=$env:SystemDrive /on=$env:SystemDrive /maxsize=5% | Out-Null; Emit-Result @{ok=$true}`); return {};
  }
  return {};
}

undo.registerHandler('fix-custom', async (e) => {
  const d = e.data, p = d.prev || {};
  switch (d.id) {
    case 'firewall': await ps.json(`foreach ($p in $A) { Set-NetFirewallProfile -Name $p.name -Enabled ($(if ($p.enabled) { 'True' } else { 'False' })) }; Emit-Result @{ok=$true}`, { args: p.profiles || [] }); break;
    case 'remoteRegistry': await ps.json(`& sc.exe config RemoteRegistry start= $(if ($A.m -eq 'Auto') { 'auto' } else { 'demand' }) | Out-Null; Emit-Result @{ok=$true}`, { args: { m: p.mode } }); break;
    case 'driveShares': await ps.json(`foreach ($s in $A) { New-SmbShare -Name $s.name -Path $s.path -ReadAccess 'Everyone' | Out-Null }; Emit-Result @{ok=$true}`, { args: p.shares || [] }); break;
    case 'folderShares': await ps.json(`foreach ($sh in $A) { foreach ($a in $sh.everyone) { Grant-SmbShareAccess -Name $sh.name -AccountName $a.account -AccessRight $a.right -Force | Out-Null } }; Emit-Result @{ok=$true}`, { args: p.shares || [] }); break;
    case 'rdp': await ps.json(`Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0; Emit-Result @{ok=$true}`); break;
    case 'wuService': await ps.json(`Stop-Service wuauserv -Force; & sc.exe config wuauserv start= disabled | Out-Null; Emit-Result @{ok=$true}`); break;
    case 'systemRestore': await ps.json(`Disable-ComputerRestore -Drive ($env:SystemDrive + '\\'); Emit-Result @{ok=$true}`); break;
  }
});

module.exports = { scan, fix };
