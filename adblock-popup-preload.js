const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('abApi', {
  onData: (cb) => ipcRenderer.on('ab-data', (_e, d) => cb(d)),
  size: (h) => ipcRenderer.send('ab-size', h),
  close: () => ipcRenderer.send('ab-close'),
  toggleSite: () => ipcRenderer.send('ab-site'),
  toggleGlobal: () => ipcRenderer.send('ab-global'),
  toggleFp: () => ipcRenderer.send('ab-fp'),
  pref: (k) => ipcRenderer.send('ab-pref', k),
  forget: () => ipcRenderer.send('ab-fm'),
  ytskip: () => ipcRenderer.send('ab-yt'),
  settings: () => ipcRenderer.send('ab-settings')
});