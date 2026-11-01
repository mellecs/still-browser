const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('emApi', {
  onData: (cb) => ipcRenderer.on('em-data', (_e, d) => cb(d)),
  size: (h) => ipcRenderer.send('em-size', h),
  close: () => ipcRenderer.send('em-close'),
  unpin: () => ipcRenderer.send('em-unpin'),
  options: () => ipcRenderer.send('em-options'),
  remove: () => ipcRenderer.send('em-remove')
});