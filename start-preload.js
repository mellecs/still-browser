const { contextBridge, ipcRenderer } = require('electron');

// Solo se activa en páginas locales (la pantalla de inicio), nunca en webs de Internet.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('chorusStart', {
    getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
    addShortcut: (name, url) => ipcRenderer.invoke('add-shortcut', name, url),
    removeShortcut: (id) => ipcRenderer.invoke('remove-shortcut', id),
    editShortcut: (id, name, url) => ipcRenderer.invoke('edit-shortcut', id, name, url), // EDITAR_ACCESO
    reorderShortcuts: (ids) => ipcRenderer.invoke('reorder-shortcuts', ids),
    setTheme: (id) => ipcRenderer.invoke('set-theme', id),
    getPrefs: () => ipcRenderer.invoke('start-get-prefs'),
    setPref: (key, value) => ipcRenderer.invoke('start-set-pref', key, value),
    onPrefs: (callback) => ipcRenderer.on('prefs-changed', (_event, p) => callback(p)),
    onTheme: (callback) => ipcRenderer.on('theme-changed', (_event, id) => callback(id)),
    getLanguage: () => ipcRenderer.invoke('get-language'),
    onLanguage: (callback) => ipcRenderer.on('language-changed', (_event, l) => callback(l))
  });
}
