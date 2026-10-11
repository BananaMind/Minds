const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('minds', {
  platform: process.platform,
  startup: {
    status: () => ipcRenderer.invoke('startup-status'),
    set: (enabled) => ipcRenderer.invoke('startup-set', enabled),
  },
  hostInfo: () => ipcRenderer.invoke('host-info'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  notify: (n) => ipcRenderer.send('notify', n),
  onOpenBot: (fn) => { const h = (_e, id) => fn(id); ipcRenderer.on('open-bot', h); return () => ipcRenderer.removeListener('open-bot', h); },
  window: { minimize: () => ipcRenderer.send('win', 'minimize'), maximize: () => ipcRenderer.send('win', 'maximize'), close: () => ipcRenderer.send('win', 'close') },
});
