// NovaTune PC Suite - Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const ps = require('./ps');

app.setAppUserModelId('com.novatune.pcsuite');
store.init(app.getPath('userData'));

const modules = {
  system: require('./modules/system'),
  maintenance: require('./modules/maintenance'),
  junk: require('./modules/junk'),
  browser: require('./modules/browser'),
  shortcuts: require('./modules/shortcuts'),
  registry: require('./modules/registry'),
  startup: require('./modules/startup'),
  disks: require('./modules/disks'),
  software: require('./modules/software'),
  fixes: require('./modules/fixes'),
  shredder: require('./modules/shredder'),
  recovery: require('./modules/recovery'),
  undo: require('./modules/undo'),
  drivers: require('./modules/drivers'),
  uninstaller: require('./modules/uninstaller'),
  files: require('./modules/files'),
  repair: require('./modules/repair')
};

// node:sqlite prints an ExperimentalWarning: keep the console clean
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const argv = process.argv.slice(1);
const flag = (f) => argv.includes(f);
const shredArgs = () => { const i = argv.indexOf('--shred'); return i >= 0 && argv[i + 1] ? [argv[i + 1]] : []; };

let win = null;
let tray = null;
let quitting = false;

// ---------- headless modes (scheduled tasks) ----------
async function headless() {
  if (flag('--auto-maintenance')) {
    try {
      await modules.maintenance.scan({}, {});
      const r = await modules.maintenance.clean({ closeBrowsers: false }, {});
      new Notification({ title: 'NovaTune PC Suite', body: `Manutenzione automatica completata: liberati ${fmt(r.freed)}.` }).show();
    } catch (e) { /* ignore */ }
    setTimeout(() => app.exit(0), 4000);
    return true;
  }
  if (flag('--driver-check')) {
    try {
      const r = await modules.drivers.scan({}, {});
      const n = r.updates.filter((u) => !u.ignored).length;
      if (n) {
        const nt = new Notification({ title: 'NovaTune Driver Updater', body: `${n} driver possono essere aggiornati. Fai clic per aprire.` });
        nt.on('click', () => { app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--driver-check').concat(['--page=drivers']) }); app.exit(0); });
        nt.show();
        setTimeout(() => app.exit(0), 60000);
        return true;
      }
    } catch (e) {}
    setTimeout(() => app.exit(0), 2000);
    return true;
  }
  return false;
}

function fmt(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function iconPath() {
  const p = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    frame: false, backgroundColor: '#0f1222', show: false,
    icon: iconPath(), title: 'NovaTune PC Suite',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, plugins: true }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (flag('--tray')) return;
    // start maximized; "restore" brings back the default 1280x820 centred window
    win.maximize();
    win.show();
  });
  win.on('close', (e) => {
    if (!quitting && store.settings().minimizeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('maximize', () => win.webContents.send('win-state', 'max'));
  win.webContents.on('did-finish-load', () => { if (win.isMaximized()) win.webContents.send('win-state', 'max'); });
  win.on('unmaximize', () => win.webContents.send('win-state', 'normal'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  const ip = iconPath();
  if (!ip) return;
  tray = new Tray(nativeImage.createFromPath(ip).resize({ width: 16, height: 16 }));
  tray.setToolTip('NovaTune PC Suite');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri NovaTune', click: () => { win.show(); win.focus(); } },
    { label: 'Esegui manutenzione', click: () => { win.show(); win.webContents.send('navigate', 'maintenance'); } },
    { label: 'Aggiorna driver', click: () => { win.show(); win.webContents.send('navigate', 'drivers'); } },
    { type: 'separator' },
    { label: 'Esci', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ---------- IPC ----------
ipcMain.handle('call', async (event, mod, fn, args) => {
  const m = modules[mod];
  if (!m || typeof m[fn] !== 'function') throw new Error(`Funzione sconosciuta: ${mod}.${fn}`);
  const ctx = { progress: (p) => { try { event.sender.send('progress', { mod, fn, ...p }); } catch (e) {} } };
  try {
    return await m[fn](args || {}, ctx);
  } catch (e) {
    console.error(mod, fn, e);
    throw new Error(e && e.message ? e.message : String(e));
  }
});

ipcMain.handle('settings:get', () => store.settings());
ipcMain.handle('settings:set', async (e, patch) => {
  const s = store.settings();
  const before = JSON.stringify(s);
  Object.assign(s, patch);
  store.save('settings');
  if ('autoMaintenance' in patch || 'driverScanSchedule' in patch) await modules.system.applySchedule().catch(() => {});
  if ('contextMenuShredder' in patch) await modules.system.setContextMenu(patch.contextMenuShredder).catch(() => {});
  if ('startWithWindows' in patch) await modules.system.setStartWithWindows(patch.startWithWindows).catch(() => {});
  return s;
});
ipcMain.handle('settings:reset', () => { store.save('settings', JSON.parse(JSON.stringify(store.DEFAULT_SETTINGS))); return store.settings(); });
ipcMain.handle('stats:get', () => store.stats());
ipcMain.handle('stats:reset', () => { const s = store.stats(); for (const k of Object.keys(s)) s[k] = Array.isArray(s[k]) ? [] : 0; store.save('stats'); return s; });

ipcMain.handle('dialog:open', async (e, opts) => {
  const r = await dialog.showOpenDialog(win, opts || {});
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:save', async (e, opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});
// PDF preview: opened in its own window (Chromium PDF viewer) from a temporary copy
ipcMain.handle('preview:pdf', async (e, data, name) => {
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'NovaTune-anteprime');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${Date.now()}_${String(name || 'anteprima.pdf').replace(/[<>:"/\\|?*]/g, '_')}`);
  fs.writeFileSync(f, Buffer.from(data));
  const w = new BrowserWindow({ width: 900, height: 1000, title: `Anteprima – ${name || ''}`, icon: iconPath(), autoHideMenuBar: true, webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false } });
  w.setMenu(null);
  w.on('closed', () => { try { fs.unlinkSync(f); } catch (er) {} });
  await w.loadFile(f);
  return { ok: true };
});
ipcMain.handle('shell:open', (e, target) => {
  if (/^(https?:|ms-settings:|windowsdefender:)/.test(target)) return shell.openExternal(target);
  return shell.openPath(target);
});
ipcMain.handle('shell:show', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), packaged: app.isPackaged, argv, initialPage: (argv.find((a) => a.startsWith('--page=')) || '').slice(7), shred: shredArgs() }));
ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('app:reboot', () => ps.exec('shutdown.exe', ['/r', '/t', '10', '/c', 'Riavvio richiesto da NovaTune PC Suite']));
ipcMain.handle('app:isAdmin', async () => { const r = await ps.exec('net.exe', ['session']); return r.code === 0; });

// ---------- lifecycle ----------
const isHeadless = flag('--auto-maintenance') || flag('--driver-check');
// the development build ("npm start") must be able to run next to the installed app
const gotLock = isHeadless || !app.isPackaged ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (e, args) => {
    if (!win) return;
    const i = args.indexOf('--shred');
    if (i >= 0 && args[i + 1]) win.webContents.send('shred-add', [args[i + 1]]);
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.whenReady().then(async () => {
    if (await headless()) return;
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
  });
  app.on('before-quit', () => { quitting = true; ps.killAll(); });
  app.on('window-all-closed', () => app.quit());
}
