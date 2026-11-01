const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('permApi', {
  onData: (cb) => ipcRenderer.on('perm-data', (_e, d) => cb(d)),
  answer: (allow, remember) => ipcRenderer.send('perm-answer', !!allow, !!remember)
});