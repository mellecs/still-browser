const { contextBridge, ipcRenderer } = require('electron');

// Solo se activa en páginas locales (la pantalla de inicio), nunca en webs de Internet.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('chorusStart', {
    getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
    addShortcut: (name, url) => ipcRenderer.invoke('add-shortcut', name, url),
    removeShortcut: (id) => ipcRenderer.invoke('remove-shortcut', id),
    reorderShortcuts: (ids) => ipcRenderer.invoke('reorder-shortcuts', ids)
  });
}
