const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('menuApi', {
  onData: (cb) => ipcRenderer.on('menu-data', (_e, d) => cb(d)),
  click: (id, value) => ipcRenderer.send('menu-click', id, value),
  close: () => ipcRenderer.send('menu-close')
});