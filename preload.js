const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chorus', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  back: () => ipcRenderer.send('back'),
  forward: () => ipcRenderer.send('forward'),
  reload: () => ipcRenderer.send('reload'),
  newTab: () => ipcRenderer.send('new-tab'),
  toggleMute: (id) => ipcRenderer.send('toggle-mute', id),
  onFocusAddress: (callback) => ipcRenderer.on('focus-address', () => callback()),
  openMenu: () => ipcRenderer.send('open-menu'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettings: (callback) => ipcRenderer.on('settings-changed', (_event, s) => callback(s)),
  switchTab: (id) => ipcRenderer.send('switch-tab', id),
  closeTab: (id) => ipcRenderer.send('close-tab', id),
  onUrlChange: (callback) =>
    ipcRenderer.on('url-changed', (_event, url) => callback(url)),
  onTabsChange: (callback) =>
    ipcRenderer.on('tabs-changed', (_event, tabs) => callback(tabs))
});


