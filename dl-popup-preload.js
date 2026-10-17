const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('dlApi', {
    onData: (cb) => ipcRenderer.on('dl-data', (_e, d) => cb(d)),
    open: (id) => ipcRenderer.send('dl-popup-open', id),
    show: (id) => ipcRenderer.send('dl-popup-show', id),
    cancel: (id) => ipcRenderer.send('dl-popup-cancel', id),
    all: () => ipcRenderer.send('dl-popup-all'),
    close: () => ipcRenderer.send('dl-popup-close'),
    size: (h) => ipcRenderer.send('dl-popup-size', h)
  });
}