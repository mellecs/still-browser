const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('settingsApi', {
    get: () => ipcRenderer.invoke('settings-page-get'),
    set: (key, value) => ipcRenderer.invoke('settings-page-set', key, value),
    setFont: (v) => ipcRenderer.invoke('settings-font-set', v), // FUENTE_AJUSTE
    defaultBrowser: () => ipcRenderer.invoke('settings-open-default-apps'), // NAVEGADOR_PREDETERMINADO
    pickDownloadsDir: () => ipcRenderer.invoke('settings-pick-downloads-dir'), // CARPETA_DESCARGAS
    onLanguage: (callback) => ipcRenderer.on('language-changed', (_event, l) => callback(l))
  });
}