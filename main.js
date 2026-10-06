const { app, BrowserWindow, WebContentsView, ipcMain, net, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const TOP_HEIGHT = 76; // 40 de pestañas + 36 de barra
const START_URL = pathToFileURL(path.join(__dirname, 'start.html')).href;
const HOME = START_URL;
let win;
let tabs = [];
let activeId = null;
let nextId = 1;

// ---------- Iconos de sitios web ----------
async function fetchAsDataUrl(url) {
  try {
    if (url.startsWith('data:image/')) {
      return url.length < 300000 ? url : null;
    }
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    let type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) {
      if (/\.ico(\?|$)/i.test(url)) type = 'image/x-icon';
      else return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 300000) return null;
    return 'data:' + type + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

async function findIconDataUrl(pageUrl) {
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(base.protocol)) return null;

  const candidates = [];
  try {
    const res = await net.fetch(base.href, { signal: AbortSignal.timeout(5000) });
    const html = (await res.text()).slice(0, 200000);
    const tags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of tags) {
      if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
      const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!m) continue;
      try {
        candidates.push(new URL(m[1], res.url || base.href).href);
      } catch {}
    }
  } catch {}
  candidates.push(base.origin + '/favicon.ico');

  for (const url of candidates) {
    const data = await fetchAsDataUrl(url);
    if (data) return data;
  }
  return null;
}

function sameHost(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '');
    const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb;
  } catch {
    return false;
  }
}

// Si visitas una web cuyo acceso directo no tiene icono, lo aprende de ella.
async function learnIcon(pageUrl, faviconUrl) {
  if (!faviconUrl || !/^https?:\/\//i.test(pageUrl)) return;
  const needs = loadShortcuts().some((s) => !s.icon && sameHost(s.url, pageUrl));
  if (!needs) return;
  const data = await fetchAsDataUrl(faviconUrl);
  if (!data) return;
  const list = loadShortcuts();
  let changed = false;
  list.forEach((s) => {
    if (!s.icon && sameHost(s.url, pageUrl)) {
      s.icon = data;
      changed = true;
    }
  });
  if (changed) saveShortcuts(list);
}

// Icono de pestaña: lo descarga Chorus, como hacen los navegadores.
const iconCache = new Map();

async function fetchTabIcon(tab, favicons, wc) {
  const pageUrl = wc.getURL();
  const list = (favicons || []).filter(
    (u) => /^https?:/i.test(u) || u.startsWith('data:image/')
  );
  try {
    list.push(new URL('/favicon.ico', pageUrl).href);
  } catch {}

  for (const url of list) {
    let data = iconCache.get(url);
    if (!data) {
      data = await fetchAsDataUrl(url);
      if (data) iconCache.set(url, data);
    }
    if (!data) continue;
    if (!tabs.includes(tab) || wc.isDestroyed() || wc.getURL() !== pageUrl) return;
    tab.favicon = data;
    sendTabs();
    learnIcon(pageUrl, data);
    return;
  }
}

// ---------- Accesos directos (se guardan en un archivo) ----------
function shortcutsFile() {
  return path.join(app.getPath('userData'), 'shortcuts.json');
}

function loadShortcuts() {
  try {
    const data = JSON.parse(fs.readFileSync(shortcutsFile(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveShortcuts(list) {
  fs.writeFileSync(shortcutsFile(), JSON.stringify(list, null, 2));
}

function cleanShortcutUrl(input) {
  let text = String(input || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  try {
    const u = new URL(text);
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

// Solo la pantalla de inicio puede usar estas órdenes.
function fromStartPage(event) {
  return event.sender.getURL().startsWith(START_URL);
}

ipcMain.handle('get-shortcuts', async (event) => {
  if (!fromStartPage(event)) return [];
  const list = loadShortcuts();
  const missing = list.filter((s) => !s.icon && !s.iconTried);
  if (missing.length) {
    await Promise.all(
      missing.map(async (s) => {
        s.icon = (await findIconDataUrl(s.url)) || '';
        s.iconTried = true;
      })
    );
    saveShortcuts(list);
  }
  return list;
});

ipcMain.handle('add-shortcut', async (event, name, url) => {
  if (!fromStartPage(event)) return null;
  const clean = cleanShortcutUrl(url);
  if (!clean) return null;
  const label =
    String(name || '').trim().slice(0, 30) ||
    new URL(clean).hostname.replace(/^www\./, '');
  const icon = (await findIconDataUrl(clean)) || '';
  const list = loadShortcuts();
  list.push({
    id: Date.now().toString(),
    name: label,
    url: clean,
    icon: icon,
    iconTried: true
  });
  saveShortcuts(list);
  return list;
});

ipcMain.handle('remove-shortcut', (event, id) => {
  if (!fromStartPage(event)) return null;
  const list = loadShortcuts().filter((s) => s.id !== id);
  saveShortcuts(list);
  return list;
});

ipcMain.handle('reorder-shortcuts', (event, ids) => {
  if (!fromStartPage(event)) return null;
  if (!Array.isArray(ids)) return null;
  const list = loadShortcuts();
  const byId = new Map(list.map((s) => [s.id, s]));
  const ordered = [];
  ids.forEach((id) => {
    const s = byId.get(String(id));
    if (s) { ordered.push(s); byId.delete(String(id)); }
  });
  byId.forEach((s) => ordered.push(s));
  saveShortcuts(ordered);
  return ordered;
});
// ---------- Navegación ----------
function normalizeUrl(input) {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!text.includes(' ') && text.includes('.')) return 'https://' + text;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(text);
}

function activeTab() {
  return tabs.find((t) => t.id === activeId);
}

function resizeView() {
  const tab = activeTab();
  if (!tab) return;
  const [width, height] = win.getContentSize();
  tab.view.setBounds({
    x: 0,
    y: TOP_HEIGHT,
    width: width,
    height: height - TOP_HEIGHT
  });
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(
    'tabs-changed',
    tabs.filter((t) => !t.view.webContents.isDestroyed()).map((t) => ({
      id: t.id,
      title: t.view.webContents.getTitle() || 'Nueva pestaña',
      favicon: t.favicon || '',
      audible: t.view.webContents.isCurrentlyAudible(),
      muted: t.view.webContents.isAudioMuted(),
      isStart: t.view.webContents.getURL().startsWith('file:'),
      active: t.id === activeId
    }))
  );
}

function sendUrl() {
  if (!win || win.isDestroyed()) return;
  const tab = activeTab();
  if (!tab) return;
  if (tab.view.webContents.isDestroyed()) return;
  const url = tab.view.webContents.getURL();
  // En la pantalla de inicio la barra de direcciones se queda vacía.
  win.webContents.send('url-changed', url.startsWith('file:') ? '' : url);
}

function switchTab(id) {
  const next = tabs.find((t) => t.id === id);
  if (!next) return;
  const current = activeTab();
  if (current) current.view.setVisible(false);
  activeId = id;
  next.view.setVisible(true);
  resizeView();
  sendTabs();
  sendUrl();
}

function createTab(url) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, String(url).includes('history.html') ? 'history-preload.js' : 'start-preload.js')
    }
  });
  const tab = { id, view, favicon: '' };
  tabs.push(tab);
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      printActiveTab();
    }
  });
  wc.on('did-navigate', (_e, navUrl) => addHistory(navUrl, wc.getTitle()));
  wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => { if (isMainFrame) addHistory(navUrl, wc.getTitle()); });
  wc.on('page-title-updated', (_e, title) => updateHistoryTitle(wc.getURL(), title));
  wc.on('dom-ready', () => {
    try {
      if (/^https?:\/\/([^\/]*\.)?youtube\.com(\/|$)/.test(wc.getURL())) {
        wc.executeJavaScript(fs.readFileSync(path.join(__dirname, 'youtube-skip.js'), 'utf8')).catch(() => {});
      }
    } catch (e) {}
  });
  wc.on('page-title-updated', () => sendTabs());
  wc.on('page-favicon-updated', (_event, favicons) => {
    fetchTabIcon(tab, favicons, wc);
  });
  wc.on('audio-state-changed', () => sendTabs());

  const onNavigate = () => {
    if (id === activeId) sendUrl();
    sendTabs();
  };
  wc.on('did-navigate', () => {
    tab.favicon = '';
    onNavigate();
  });
  wc.on('did-navigate-in-page', onNavigate);
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });

  wc.loadURL(url);
  switchTab(id);

  // Pestaña nueva con la pantalla de inicio: el cursor va a la barra de direcciones.
  if (url === HOME) {
    const focusAddress = () => {
      win.webContents.focus();
      win.webContents.send('focus-address');
    };
    setTimeout(focusAddress, 100);
    wc.once('did-finish-load', () => setTimeout(focusAddress, 50));
  }
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();

  if (tabs.length === 0) {
    createTab(HOME);
    return;
  }
  if (id === activeId) {
    switchTab(tabs[Math.max(0, index - 1)].id);
  } else {
    sendTabs();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Still Browser',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1f22', symbolColor: '#cccccc', height: 40 },
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  win.on('resize', resizeView);
  win.webContents.once('did-finish-load', () => createTab(HOME));
}

ipcMain.on('navigate', (_event, input) => {
  const url = normalizeUrl(input);
  const tab = activeTab();
  if (url && tab) tab.view.webContents.loadURL(url);
});

ipcMain.on('back', () => {
  const tab = activeTab();
  if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
    tab.view.webContents.navigationHistory.goBack();
  }
});

ipcMain.on('forward', () => {
  const tab = activeTab();
  if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
    tab.view.webContents.navigationHistory.goForward();
  }
});

ipcMain.on('reload', () => {
  const tab = activeTab();
  if (tab) tab.view.webContents.reload();
});

ipcMain.on('new-tab', () => createTab(HOME));
ipcMain.on('toggle-mute', (_event, id) => {
  const t = tabs.find((x) => x.id === id);
  if (!t || t.view.webContents.isDestroyed()) return;
  t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted());
  sendTabs();
});
ipcMain.on('switch-tab', (_event, id) => switchTab(id));
ipcMain.on('close-tab', (_event, id) => closeTab(id));

// ---------- Extensiones (carpeta "extensions") ----------
async function loadExtensions() {
  const dir = path.join(__dirname, 'extensions');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const extPath = path.join(dir, name);
    if (!fs.existsSync(path.join(extPath, 'manifest.json'))) continue;
    try {
      const ext = await session.defaultSession.extensions.loadExtension(extPath, {
        allowFileAccess: true
      });
      console.log('Extensión cargada:', ext.name);
    } catch (err) {
      console.log('No se pudo cargar', name, '-', err.message);
    }
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  loadExtensions().then(() => { startAdblock(); createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});




// ---------- Bloqueador de anuncios y rastreadores (Ghostery adblocker) ----------
async function startAdblock() {
  try {
    const { ElectronBlocker } = await import('@ghostery/adblocker-electron');
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(
      (url, init) => net.fetch(url, init)
    );
    // blocker.enableBlockingInSession(session.defaultSession);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let page = '';
      try { page = details.webContents ? details.webContents.getURL() : ''; } catch (e) {}
      const esYT = /^https?:\/\/([^\/]*\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/;
      if (esYT.test(page) || esYT.test(details.url)) return callback({});
      blocker.onBeforeRequest(details, callback);
    });
    console.log('Bloqueador de anuncios activado');
  } catch (err) {
    console.log('No se pudo activar el bloqueador:', err.message);
  }
}


// ---------- Historial, ajustes y menú de las tres barras ----------
const { nativeTheme } = require('electron');
const historyFile = path.join(app.getPath('userData'), 'history.json');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let historyList = [];
let settings = { dark: false, compact: false };
try { historyList = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) {}
try { settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (e) {}
nativeTheme.themeSource = 'system';

let historyTimer = null;
function writeHistory() { try { fs.writeFileSync(historyFile, JSON.stringify(historyList)); } catch (e) {} }
function saveHistory() { clearTimeout(historyTimer); historyTimer = setTimeout(writeHistory, 1000); }
app.on('before-quit', writeHistory);

function addHistory(url, title) {
  if (!/^https?:/i.test(url)) return;
  if (historyList[0] && historyList[0].url === url) return;
  historyList.unshift({ url, title: title || url, time: Date.now() });
  if (historyList.length > 5000) historyList.length = 5000;
  saveHistory();
}
function updateHistoryTitle(url, title) {
  const e = historyList.find((h) => h.url === url);
  if (e && title) { e.title = title; saveHistory(); }
}

ipcMain.handle('history-get', () => historyList);
ipcMain.handle('history-remove', (_e, time, url) => {
  historyList = historyList.filter((h) => !(h.time === time && h.url === url));
  saveHistory();
  return historyList;
});
ipcMain.handle('history-clear', () => { historyList = []; saveHistory(); return historyList; });
ipcMain.on('history-open', (_e, url) => { if (/^https?:/i.test(url)) createTab(url); });

function openHistoryTab() {
  const url = require('url').pathToFileURL(path.join(__dirname, 'history.html')).href;
  const open = tabs.find((t) => !t.view.webContents.isDestroyed() && t.view.webContents.getURL() === url);
  if (open) switchTab(open.id); else createTab(url);
}

function applySettings() {
  nativeTheme.themeSource = 'system';
  if (win && !win.isDestroyed()) win.webContents.send('settings-changed', settings);
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch (e) {}
}
ipcMain.handle('get-settings', () => settings);

ipcMain.on('open-menu', () => {
  const menu = Menu.buildFromTemplate([
    { label: 'Historial', click: () => openHistoryTab() },
    { label: 'Imprimir', click: () => printActiveTab() },
  ]);
  menu.popup({ window: win });
});

// ---------- Imprimir ----------
function printActiveTab() {
  const tab = activeTab();
  if (!tab || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.print({ printBackground: true });
}
