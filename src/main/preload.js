const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (mod, fn, args) => ipcRenderer.invoke('call', mod, fn, args),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  stats: () => ipcRenderer.invoke('stats:get'),
  resetStats: () => ipcRenderer.invoke('stats:reset'),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  open: (target) => ipcRenderer.invoke('shell:open', target),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  appInfo: () => ipcRenderer.invoke('app:info'),
  isAdmin: () => ipcRenderer.invoke('app:isAdmin'),
  reboot: () => ipcRenderer.invoke('app:reboot'),
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close')
  },
  filePath: (file) => webUtils.getPathForFile(file),
  on: (channel, cb) => {
    const ok = ['progress', 'navigate', 'shred-add', 'win-state'];
    if (!ok.includes(channel)) return () => {};
    const h = (e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});
