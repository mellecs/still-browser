const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('downloadsApi', {
    get: () => ipcRenderer.invoke('downloads-get'),
    open: (id) => ipcRenderer.invoke('downloads-open', id),
    show: (id) => ipcRenderer.send('downloads-show', id),
    cancel: (id) => ipcRenderer.send('downloads-cancel', id),
    remove: (id) => ipcRenderer.invoke('downloads-remove', id),
    clear: () => ipcRenderer.invoke('downloads-clear'),
    getLanguage: () => ipcRenderer.invoke('get-language'),
    onLanguage: (callback) => ipcRenderer.on('language-changed', (_event, l) => callback(l))
  });
}
