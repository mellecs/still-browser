const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('splitApi', {
    onData: (cb) => ipcRenderer.on('split-pick-data', (_e, d) => cb(d)),
    choose: (id) => ipcRenderer.send('split-pick-choose', id),
    close: () => ipcRenderer.send('split-pick-close')
  });
}