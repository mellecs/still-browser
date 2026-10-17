const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historyApi', {
  get: () => ipcRenderer.invoke('history-get'),
  remove: (time, url) => ipcRenderer.invoke('history-remove', time, url),
  clear: () => ipcRenderer.invoke('history-clear'),
  open: (url) => ipcRenderer.send('history-open', url),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  onLanguage: (callback) => ipcRenderer.on('language-changed', (_event, l) => callback(l))
});
