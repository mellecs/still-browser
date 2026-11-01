const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spApi', {
  onData: (cb) => ipcRenderer.on('sp-data', (_e, d) => cb(d)),
  size: (h) => ipcRenderer.send('sp-size', h),
  close: () => ipcRenderer.send('sp-close'),
  clear: () => ipcRenderer.send('sp-clear'),
  settings: () => ipcRenderer.send('sp-settings'),
  removePerm: (key) => ipcRenderer.send('sp-perm-remove', key)
});