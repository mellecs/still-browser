const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('extApi', {
  get: () => ipcRenderer.invoke('ext-page-get'),
  toggle: (id) => ipcRenderer.invoke('ext-page-toggle', id),
  options: (id) => ipcRenderer.invoke('ext-page-options', id),
  remove: (id) => ipcRenderer.invoke('ext-page-remove', id),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  onLanguage: (callback) => ipcRenderer.on('language-changed', (_event, l) => callback(l))
});