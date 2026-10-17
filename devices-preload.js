const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devicesApi', {
  onData: (cb) => ipcRenderer.on('devices-data', (_e, d) => cb(d)),
  choose: (id) => ipcRenderer.send('devices-choose', id),
  cancel: () => ipcRenderer.send('devices-cancel')
});