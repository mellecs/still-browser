const { app, BrowserWindow, WebContentsView, ipcMain, net, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { ElectronChromeExtensions } = require('electron-chrome-extensions'); // EXTENSIONES_BARRA

const TOP_HEIGHT = 76; // 40 de pestañas + 36 de barra
const START_URL = pathToFileURL(path.join(__dirname, 'start.html')).href;
const HOME = START_URL;
let win;
let chromeExt = null; // EXTENSIONES_BARRA
let tabs = [];
let activeId = null;
let nextId = 1;

// VENTANAS_MULTIPLES: varias ventanas en el mismo proceso (misma sesion)
const WINS = [];
let curCtx = null;
// ENLACES_EXTERNOS: abre en una pestana los enlaces http/https (y .html locales) que llegan desde Windows
const ENLACES_GOT_LOCK = app.requestSingleInstanceLock();
if (!ENLACES_GOT_LOCK) app.exit(0);
let enlacePendiente = null;
function urlDeArgs(args) {
  for (const a of (args || []).slice(1)) {
    const t = String(a || '').trim().replace(/^"|"$/g, '');
    if (!t || t.length > 8000 || t.startsWith('--')) continue;
    if (/^https?:\/\//i.test(t)) return t;
    if (/\.html?$/i.test(t)) {
      try { if (require('fs').statSync(t).isFile()) return require('url').pathToFileURL(t).href; } catch (e) {}
    }
  }
  return null;
}
function ctxVivo() {
  syncCtx();
  const vivos = WINS.filter((x) => { try { return x.win && !x.win.isDestroyed(); } catch (e) { return false; } });
  return vivos.find((x) => { try { return x.win.isFocused(); } catch (e) { return false; } }) || vivos[vivos.length - 1] || null;
}
function abrirEnlaceExterno(u) {
  const c = ctxVivo();
  if (!c || !app.isReady()) { if (u) enlacePendiente = u; return; }
  useCtx(c);
  if (u) createTab(u);
  try { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } catch (e) {}
}
app.on('second-instance', (_e, argv) => abrirEnlaceExterno(urlDeArgs(argv)));
enlacePendiente = urlDeArgs(process.argv);
function syncCtx() {
  if (curCtx) { curCtx.win = win; curCtx.tabs = tabs; curCtx.activeId = activeId; curCtx.findOpen = findOpen; }
}
function useCtx(c) {
  if (!c || c === curCtx) return;
  syncCtx();
  curCtx = c;
  win = c.win; tabs = c.tabs; activeId = c.activeId; findOpen = c.findOpen;
}
function mkCtx(w) {
  const c = { win: w, tabs: tabs, activeId: activeId, findOpen: false };
  WINS.push(c);
  if (!curCtx) curCtx = c;
  return c;
}
function ctxOfWC(wc) {
  syncCtx();
  for (const c of WINS) {
    try { if (c.win && !c.win.isDestroyed() && c.win.webContents === wc) return c; } catch (e) {}
    if (c.tabs.some((t) => { try { return t.view.webContents === wc; } catch (e) { return false; } })) return c;
  }
  return null;
}
function dropCtx(c) {
  const i = WINS.indexOf(c);
  if (i === -1) return;
  if (curCtx === c) syncCtx();
  WINS.splice(i, 1);
  c.tabs.forEach((t) => { try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch (e) {} });
  if (curCtx === c) { curCtx = null; if (WINS[0]) useCtx(WINS[0]); }
  try { scheduleSessionSave(); } catch (e) {}
}
function allWindowTabs() {
  syncCtx();
  if (!WINS.length) return tabs;
  return [].concat(...WINS.map((c) => c.tabs));
}
function mainActiveId() {
  syncCtx();
  return WINS.length ? WINS[0].activeId : activeId;
}
// MARCO_RELAYOUT: recalcula el tamano de la pagina en todas las ventanas (al activar o desactivar el marco)
function relayoutAll() {
  if (!WINS.length) { resizeView(); return; }
  const prev = curCtx;
  WINS.slice().forEach((c) => { try { useCtx(c); resizeView(); } catch (e) {} });
  if (prev && WINS.includes(prev)) useCtx(prev);
}

function updateOverlay() { try { setTimeout(() => { try { relayoutAll(); } catch (e) {} }, 0); } catch (e) {} /* MARCO_COLOR */
  if (!WINS.length) { updateOverlayOne(); return; }
  const prev = curCtx;
  WINS.slice().forEach((c) => { try { useCtx(c); updateOverlayOne(); } catch (e) {} });
  if (prev && WINS.includes(prev)) useCtx(prev);
}

// Cada mensaje de una ventana o pestana cambia primero al contexto de esa ventana
{
  const origOn = ipcMain.on.bind(ipcMain);
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.on = function (ch, fn) {
    const w = function (event, ...a) { try { useCtx(ctxOfWC(event.sender)); } catch (e) {} return fn.call(this, event, ...a); };
    w.listener = fn;
    return origOn(ch, w);
  };
  ipcMain.handle = function (ch, fn) {
    return origHandle(ch, function (event, ...a) { try { useCtx(ctxOfWC(event.sender)); } catch (e) {} return fn.call(this, event, ...a); });
  };
}

function detachTabToWindow(tab, sx, sy) {
  const { screen } = require('electron');
  const sb = win.getBounds();
  const opts = {
    width: sb.width, height: sb.height,
    title: 'Still Browser',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1f22', symbolColor: '#cccccc', height: 40 },
    backgroundColor: '#1e1f22',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  };
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    const wa = screen.getDisplayNearestPoint({ x: Math.round(sx), y: Math.round(sy) }).workArea;
    opts.width = Math.min(sb.width, wa.width);
    opts.height = Math.min(sb.height, wa.height);
    opts.x = Math.max(wa.x, Math.min(Math.round(sx) - 120, wa.x + wa.width - opts.width));
    opts.y = Math.max(wa.y, Math.min(Math.round(sy) - 20, wa.y + wa.height - opts.height));
  }
  const nw = new BrowserWindow(opts);
  const ctx = { win: nw, tabs: [], activeId: null, findOpen: false };
  WINS.push(ctx);
  nw.loadFile('index.html');
  nw.on('resize', () => { useCtx(ctx); resizeView(); });
  nw.on('closed', () => dropCtx(ctx));
  nw.webContents.on('before-input-event', (event, input) => { useCtx(ctx); handleShortcut(event, input); });

  const idx = tabs.indexOf(tab);
  tabs.splice(idx, 1);
  try { win.contentView.removeChildView(tab.view); } catch (e) {}
  if (activeId === tab.id) {
    activeId = null;
    const nxt = tabs[Math.max(0, idx - 1)];
    if (nxt) switchTab(nxt.id);
  } else {
    sendTabs();
  }

  tab.ctx = ctx;
  ctx.tabs.push(tab);
  nw.contentView.addChildView(tab.view);
  try { tab.view.setVisible(false); } catch (e) {}
  nw.webContents.once('did-finish-load', () => {
    useCtx(ctx);
    try { updateOverlayOne(); } catch (e) {}
    if (tabs.includes(tab)) switchTab(tab.id);
  });
}

function moveTabToCtx(tab, target) { // VOLVER_PESTANA
  const srcCtx = curCtx;
  const srcWin = win;
  const idx = tabs.indexOf(tab);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  try { srcWin.contentView.removeChildView(tab.view); } catch (e) {}
  const wasActive = activeId === tab.id;
  if (wasActive) activeId = null;
  if (tabs.length) {
    if (wasActive) switchTab(tabs[Math.max(0, idx - 1)].id); else sendTabs();
  }
  syncCtx();
  tab.ctx = target;
  target.tabs.push(tab);
  useCtx(target);
  target.win.contentView.addChildView(tab.view);
  try { tab.view.setVisible(false); } catch (e) {}
  switchTab(tab.id);
  try { target.win.focus(); } catch (e) {}
  if (!srcCtx.tabs.length) setImmediate(() => { try { srcWin.close(); } catch (e) {} });
}
ipcMain.on('detach-tab', (event, id, sx, sy) => {
  console.log('DETACH recibido:', id, sx, sy, 'pestanas:', tabs.map((x) => x.id).join(','));
  const tab = tabs.find((t) => t.id === Number(id));
  if (!tab) return;
  const target = WINS.find((c) => {
    if (c === curCtx || !c.win || c.win.isDestroyed()) return false;
    const b = c.win.getBounds();
    return Number(sx) >= b.x && Number(sx) <= b.x + b.width && Number(sy) >= b.y && Number(sy) <= b.y + topH() + 8;
  });
  if (target) { try { moveTabToCtx(tab, target); } catch (e) { console.log('Volver pestana:', e.message); } return; }
  if (tabs.length < 2) return;
  try { detachTabToWindow(tab, Number(sx), Number(sy)); } catch (e) { console.log('Ventana nueva:', e.message); }
});


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

ipcMain.handle('edit-shortcut', async (event, id, name, url) => { // EDITAR_ACCESO
  if (!fromStartPage(event)) return null;
  const clean = cleanShortcutUrl(url);
  if (!clean) return null;
  const list = loadShortcuts();
  const s = list.find((x) => String(x.id) === String(id));
  if (!s) return null;
  const label =
    String(name || '').trim().slice(0, 30) ||
    new URL(clean).hostname.replace(/^www\./, '');
  if (clean !== s.url) {
    s.icon = (await findIconDataUrl(clean)) || '';
    s.iconTried = true;
  }
  s.name = label;
  s.url = clean;
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
// BUSCADOR_ELEGIBLE: buscador de la barra de direcciones (se elige en el menu de las tres barras)
const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://noai.duckduckgo.com/?noai=1&t=h_&ia=web&q=' }, // DDG_SIN_IA
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=' }
};
function searchEngine() {
  let id = 'duckduckgo';
  try { if (settings && settings.searchEngine) id = settings.searchEngine; } catch (e) {}
  return SEARCH_ENGINES[id] || SEARCH_ENGINES.duckduckgo;
}
function searchUrl(text) { return searchEngine().url + encodeURIComponent(text); }
const SETTINGS_PAGE_URL = require('url').pathToFileURL(path.join(__dirname, 'settings.html')).href;

function normalizeUrl(input) {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!text.includes(' ') && text.includes('.')) return 'https://' + text;
  return searchUrl(text);
}

// DEVTOOLS_F12: consola de desarrollador (F12 o Ctrl+Shift+I) de la pestana activa
// DEVTOOLS_LATERAL: herramientas de desarrollo acopladas a la derecha de la pestana
const DEV_W = 480;
function devSync(tab) {
  try {
    if (!tab || !tab.devView || tab.devView.webContents.isDestroyed()) return;
    const w = tab.devWin;
    if (!w || w.isDestroyed()) return;
    const show = !!tab.devOpen && tab.id === activeId;
    tab.devView.setVisible(show);
    if (!show) return;
    const [width, height] = w.getContentSize();
    const full = !!tab.htmlFull;
    const marco = !full && settings.roundedFrame !== false; // MARCO_OPCION
    const m = marco ? FRAME_M : 0;
    const top = full ? 0 : topH() + (findOpen ? FIND_H : 0);
    const dw = Math.min(DEV_W, Math.floor(width / 2));
    try { tab.devView.setBorderRadius(marco ? FRAME_R : 0); } catch (e) {}
    tab.devView.setBounds({ x: width - dw - m, y: top, width: dw, height: Math.max(0, height - top - m) });
  } catch (e) {}
}
function closeDevPanel(tab) {
  if (!tab || !tab.devOpen) return;
  tab.devOpen = false;
  const dv = tab.devView;
  const w = tab.devWin;
  tab.devView = null;
  try { if (!tab.view.webContents.isDestroyed() && tab.view.webContents.isDevToolsOpened()) tab.view.webContents.closeDevTools(); } catch (e) {}
  try { if (dv && w && !w.isDestroyed()) w.contentView.removeChildView(dv); } catch (e) {}
  try { if (dv && !dv.webContents.isDestroyed()) dv.webContents.close(); } catch (e) {}
  try { resizeView(); } catch (e) {}
}
function toggleDevTools(wc) {
  try {
    if (!wc || wc.isDestroyed()) return;
    const tab = tabs.find((t) => t.view.webContents === wc);
    if (!tab) {
      if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
      return;
    }
    if (tab.devOpen) { closeDevPanel(tab); return; }
    const dv = new WebContentsView();
    win.contentView.addChildView(dv);
    tab.devView = dv;
    tab.devWin = win;
    tab.devOpen = true;
    wc.setDevToolsWebContents(dv.webContents);
    wc.openDevTools({ mode: 'detach' }); // DEVTOOLS_LATERAL: con detach usa el panel propio y no abre ventana
    wc.once('devtools-closed', () => closeDevPanel(tab));
    wc.once('destroyed', () => closeDevPanel(tab));
    resizeView();
  } catch (e) { console.log('Consola lateral:', e.message); }
}
function devToolsKey(event, input, wc) {
  if (input.type !== 'keyDown') return false;
  const k = String(input.key || '').toLowerCase();
  const f12 = k === 'f12' && !input.control && !input.alt && !input.meta && !input.shift;
  const ctrlShiftI = (input.control || input.meta) && input.shift && !input.alt && k === 'i';
  if (!f12 && !ctrlShiftI) return false;
  event.preventDefault();
  toggleDevTools(wc);
  return true;
}
app.on('browser-window-created', (_e, w) => {
  try {
    w.webContents.on('before-input-event', (event, input) => {
      const t = activeTab();
      devToolsKey(event, input, t && t.view.webContents);
    });
  } catch (e) {}
});

function activeTab() {
  return tabs.find((t) => t.id === activeId);
}

// MARCO_REDONDEADO: margen alrededor del contenido web con esquinas redondeadas (cambia los dos numeros para ajustarlo)
const FRAME_M = 3;
const FRAME_R = 10;
function resizeView() {
  const tab = activeTab();
  if (!tab) return;
  const [width, height] = win.getContentSize();
  const full = !!tab.htmlFull;
  const marco = !full && settings.roundedFrame !== false; // MARCO_OPCION
  const m = marco ? FRAME_M : 0;
  const dev = (tab.devOpen && tab.devView && !tab.devView.webContents.isDestroyed()) ? Math.min(DEV_W, Math.floor(width / 2)) : 0;
  const top = full ? 0 : topH() + (findOpen ? FIND_H : 0);
  try { tab.view.setBorderRadius(marco ? FRAME_R : 0); } catch (e) {} try { win.setBackgroundColor(marco ? menuColors().bg : '#1e1f22'); } catch (e) {} /* MARCO_COLOR */
  tab.view.setBounds({
    x: m,
    y: top,
    width: Math.max(0, width - 2 * m - dev),
    height: Math.max(0, height - top - m)
  });
  devSync(tab);
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(
    'tabs-changed',
    tabs.filter((t) => !t.view.webContents.isDestroyed()).map((t) => ({
      id: t.id,
      title: (t.suspended && t.savedTitle) || t.view.webContents.getTitle() || tr('newTab'),
      favicon: (t.suspended && t.savedFavicon) || t.favicon || '',
      audible: t.view.webContents.isCurrentlyAudible(),
      suspended: !!t.suspended,
      muted: t.view.webContents.isAudioMuted(),
      pinned: !!t.pinned,
      isStart: t.view.webContents.getURL().startsWith('file:'),
      loading: !!t.loading && !t.suspended && !t.view.webContents.getURL().startsWith('file:'),
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
  if (current) { current.view.setVisible(false); try { if (current.devView) current.devView.setVisible(false); } catch (e) {} } // DEVTOOLS_LATERAL
  activeId = id;
  next.view.setVisible(true); try { if (chromeExt) chromeExt.selectTab(next.view.webContents); } catch (e) {} // EXTENSIONES_BARRA
  resizeView();
  sendTabs();
  sendUrl();
}

// SOLO_LOGIN_VENTANA: solo los inicios de sesion abren ventana emergente; el resto va a pestana nueva
function esEmergenteLogin(url) {
  try {
    const u = new URL(String(url));
    const h = u.hostname.toLowerCase();
    if (/^accounts\.(google|youtube)\.com$/.test(h)) return true;
    if (/(^|\.)(login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/.test(h)) return true;
    if (/(^|\.)(steamcommunity\.com|facebook\.com|discord\.com|github\.com|twitter\.com|x\.com)$/.test(h)) {
      return /(login|oauth|auth|dialog|signin|sign_in|openid|authorize|sso)/i.test(u.pathname);
    }
  } catch (e) {}
  return false;
}

// MARCO_REAPLICAR: las webs recrean su vista al navegar y pierden las esquinas; se reaplican al cargar
function reapplyFrame(tab) {
  try {
    if (!tab || tab.id !== activeId || tab.view.webContents.isDestroyed()) return;
    const marco = !tab.htmlFull && settings.roundedFrame !== false;
    if (marco) { tab.view.setBorderRadius(0); tab.view.setBorderRadius(FRAME_R); }
    resizeView();
  } catch (e) {}
}

// MARCO_CSS: esquinas redondeadas dibujadas dentro de la propia pagina (no dependen del recorte de Electron)
async function applyFrameCss(tab) {
  try {
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const wc = tab.view.webContents;
    if (tab.frameCssKey) { try { await wc.removeInsertedCSS(tab.frameCssKey); } catch (e) {} tab.frameCssKey = null; }
    if (!/^https?:/i.test(String(wc.getURL()))) return;
    if (tab.htmlFull || settings.roundedFrame === false) return;
    let col = '#1e1f22';
    try { col = menuColors().bg; } catch (e) {} /* MARCO_COLOR_UNIDO */
    tab.frameCssKey = await wc.insertCSS('html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647;border-radius:' + FRAME_R + 'px;box-shadow:0 0 0 ' + (FRAME_R * 2) + 'px ' + col + ';}');
  } catch (e) {}
}

function createTab(url) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: {
      plugins: true, /* PDF_VISOR */ preload: path.join(__dirname, String(url) === HISTORY_URL ? 'history-preload.js' : (String(url) === DOWNLOADS_URL ? 'downloads-preload.js' : (String(url) === SETTINGS_PAGE_URL ? 'settings-preload.js' : 'start-preload.js')))
    }
  });
  const tab = { id, view, favicon: '', ctx: curCtx };
  tabs.push(tab);
  // FONDO_PAGINAS: sin destello blanco al abrir paginas internas
  try {
    const su = String(url).split('#')[0];
    const esInicio = (su === String(START_URL).split('#')[0]); // FONDO_INICIO
    if (esInicio || su === HISTORY_URL || su === DOWNLOADS_URL || su === SETTINGS_PAGE_URL) {
      const tt = (typeof OVERLAY_THEMES !== 'undefined') ? OVERLAY_THEMES[settings.theme] : null;
      view.setBackgroundColor(tt ? hslHex(tt.h, tt.s, tt.l) : (esInicio ? '#1e1f22' : '#1e1f22'));
    }
  } catch (e) {}
  win.contentView.addChildView(view);

  const wc = view.webContents; try { if (chromeExt) chromeExt.addTab(wc, win); } catch (e) {} // EXTENSIONES_BARRA
  const wcOn = wc.on.bind(wc);
  wc.on = function (ev, fn) {
    const w = function (...a) { // OBJETO_DESTRUIDO: ignora el error al cerrar pestanas emergentes
      try { if (tab.ctx) useCtx(tab.ctx); return fn.apply(this, a); }
      catch (e) { if (/Object has been destroyed/i.test(String(e && e.message))) return; throw e; }
    };
    w.listener = fn;
    return wcOn(ev, w);
  };
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      printActiveTab();
    }
  });
  wc.on('did-navigate', (_e, navUrl) => addHistory(navUrl, wc.getTitle()));
  wc.on('did-start-navigation', (e, u2, inPlace, isMain2) => { // FONDO_WEB
    try {
      const principal = (e && typeof e.isMainFrame === 'boolean') ? e.isMainFrame : isMain2;
      if (principal === false) return;
      const nu = String((e && e.url) || u2 || '');
      if (/^https?:/i.test(nu)) { view.setBackgroundColor('#ffffff'); }
      else if (/^file:/i.test(nu)) {
        const tt = (typeof OVERLAY_THEMES !== 'undefined') ? OVERLAY_THEMES[settings.theme] : null;
        view.setBackgroundColor(tt ? hslHex(tt.h, tt.s, tt.l) : '#1e1f22');
      }
    } catch (err) {}
  });
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
  wc.on('dom-ready', () => applyFrameCss(tab)); /* MARCO_CSS */
  wc.on('did-navigate', () => { tab.frameCssKey = null; });
  wc.on('dom-ready', () => reapplyFrame(tab)); /* MARCO_REAPLICAR */
  wc.on('did-finish-load', () => reapplyFrame(tab));
  wc.on('did-navigate', () => { reapplyFrame(tab); setTimeout(() => reapplyFrame(tab), 150); });
  // PANTALLA_COMPLETA_HTML: el video a pantalla completa tapa las barras
  wc.on('enter-html-full-screen', () => {
    tab.fsPrev = win.isFullScreen();
    tab.htmlFull = true;
    try { if (!tab.fsPrev) win.setFullScreen(true); } catch (e) {}
    resizeView();
  });
  wc.on('leave-html-full-screen', () => {
    tab.htmlFull = false;
    try { if (!tab.fsPrev && win.isFullScreen()) win.setFullScreen(false); } catch (e) {}
    resizeView();
  });
  wc.on('did-start-loading', () => { tab.loading = true; sendTabs(); });
  wc.on('did-stop-loading', () => { tab.loading = false; sendTabs(); });
  wc.on('render-process-gone', () => { tab.loading = false; });
  addContextMenu(wc);
  wc.on('before-input-event', (event, input) => handleShortcut(event, input));
  wc.on('before-input-event', (event, input) => devToolsKey(event, input, wc)); // DEVTOOLS_F12
  attachExtras(wc, tab);
  wc.on('dom-ready', () => applySavedZoom(wc));
  wc.on('did-navigate', () => applySavedZoom(wc));

  const onNavigate = () => {
    if (id === activeId) sendUrl();
    sendTabs();
  };
  wc.on('did-navigate', () => {
    tab.favicon = '';
    onNavigate();
  });
  wc.on('did-navigate-in-page', onNavigate);
  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    if (!/^(https?:|blob:|about:blank$)/i.test(String(url))) { segExterno(wc, url); return { action: 'deny' }; } // SEG_NAV
    // EMERGENTES_REALES: inicios de sesion (Google, Steam, Facebook) necesitan window.opener
    if ((disposition === 'new-window' || (features && features.length > 0)) && esEmergenteLogin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true, width: 520, height: 700 }
      };
    }
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
  rememberClosed(tab, index);
  if (tabs.length === 0 && WINS.length > 1) { try { win.contentView.removeChildView(tab.view); } catch (e) {} try { tab.view.webContents.close(); } catch (e) {} const lastWin = win; setImmediate(() => { try { lastWin.close(); } catch (e) {} }); return; }
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
  const myC = mkCtx(win);
  win.on('closed', () => dropCtx(myC));
  updateOverlay();
  win.on('resize', () => { useCtx(myC); resizeView(); });
  win.webContents.on('before-input-event', (event, input) => { useCtx(myC); handleShortcut(event, input); });
  win.webContents.once('did-finish-load', () => restoreSession());
}

ipcMain.on('navigate', (_event, input) => {
  const url = normalizeUrl(input);
  const tab = activeTab();
  if (url && tab) tab.view.webContents.loadURL(url);
});

ipcMain.on('back', () => {
  const tab = activeTab();
  if (tab && tab.cameFrom && !tab.view.webContents.navigationHistory.canGoBack()) { volverAlOrigen(tab); } else if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
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

// PESTANAS_MENU_DERECHO: menu del boton derecho sobre una pestana
function tabMenuText() {
  const es = settings && settings.language === 'es';
  return es ? {
    duplicate: 'Duplicar pesta\u00f1a', pin: 'Anclar pesta\u00f1a', unpin: 'Desanclar pesta\u00f1a',
    mute: 'Silenciar pesta\u00f1a', unmute: 'Activar sonido de la pesta\u00f1a',
    closeOthers: 'Cerrar las dem\u00e1s pesta\u00f1as', close: 'Cerrar pesta\u00f1a'
  } : {
    duplicate: 'Duplicate tab', pin: 'Pin tab', unpin: 'Unpin tab',
    mute: 'Mute tab', unmute: 'Unmute tab',
    closeOthers: 'Close other tabs', close: 'Close tab'
  };
}

function pinTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  tabs.splice(tabs.indexOf(tab), 1);
  let n = 0;
  tabs.forEach((t, k) => { if (t.pinned) n = k + 1; });
  tabs.splice(n, 0, tab);
  sendTabs();
}

function duplicateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const url = tab.view.webContents.getURL();
  if (!url) return;
  createTab(url);
  const copy = tabs[tabs.length - 1];
  const from = tabs.indexOf(tab);
  if (copy && copy !== tab && from !== -1 && !tab.pinned) {
    tabs.splice(tabs.length - 1, 1);
    tabs.splice(from + 1, 0, copy);
    sendTabs();
  }
}

function closeOtherTabs(id) {
  if (!tabs.some((t) => t.id === id)) return;
  switchTab(id);
  tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id).forEach((tid) => closeTab(tid));
}

// MENU_PESTANAS: el clic derecho de las pestanas usa el mismo panel que el menu principal
let tabMenuCtx = null;
let tabMenuTarget = null;
ipcMain.on('tab-menu', (_event, id) => {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || !win || win.isDestroyed() || tab.view.webContents.isDestroyed()) return;
  if (menuOpen) closeMenuPanel();
  const p = require('electron').screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  tabMenuTarget = id;
  tabMenuCtx = { x: Math.round(p.x - b.x), y: Math.round(p.y - b.y) };
  openMenuPanel();
});

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
  // EXTENSIONES_BARRA: iconos y ventanitas de las extensiones en la barra
  try {
    const EXT_LICENSE = 'GPL-3.0'; // licencia con la que usas electron-chrome-extensions (ver su LICENSE.md)
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
    chromeExt = new ElectronChromeExtensions({
      license: EXT_LICENSE,
      session: session.defaultSession,
      createTab: async (details) => {
        createTab((details && details.url) || HOME);
        const t = tabs[tabs.length - 1];
        return [t.view.webContents, win];
      },
      selectTab: (wc) => { const t = tabs.find((x) => x.view.webContents === wc); if (t) switchTab(t.id); },
      removeTab: (wc) => { const t = tabs.find((x) => x.view.webContents === wc); if (t) closeTab(t.id); }
    });
  } catch (e) { console.log('Extensiones en la barra:', e.message); }
  loadExtensions().then(async () => { try { await require('electron-chrome-web-store').installChromeWebStore({ session: session.defaultSession, autoUpdate: true }); console.log('Tienda de Chrome activada'); } catch (e) { console.log('Tienda de Chrome:', e.message); } /* TIENDA_CHROME */ startAdblock(); createWindow(); win.webContents.once('did-finish-load', () => setTimeout(() => { const u = enlacePendiente; enlacePendiente = null; if (u) abrirEnlaceExterno(u); }, 800)); });
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
      if (details.resourceType === 'cspReport') return callback({ cancel: true }); /* SEG_PRIV_HOOK */ const up = segRedirect(details); // SEGURIDAD_HOOK
      if (up) return callback({ redirectURL: up });
      const esYT = /^https?:\/\/([^\/]*\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/;
      if (esYT.test(page) || esYT.test(details.url)) return callback({});
      if (settings.adblock === false) return callback({}); /* ADBLOCK_BOTON */ blocker.onBeforeRequest(details, callback);
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
let settings = { dark: false, compact: false, showDownloads: true, theme: 'actual', language: 'en' };
try { historyList = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) {}
try { settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (e) {}
// ACELERACION_HARDWARE: debe ir antes de que arranque la app
if (settings.hardwareAcceleration === false) app.disableHardwareAcceleration();
nativeTheme.themeSource = 'system';

let historyTimer = null;
function writeHistory() { try { fs.writeFileSync(historyFile, JSON.stringify(historyList)); } catch (e) {} }
function saveHistory() { clearTimeout(historyTimer); historyTimer = setTimeout(writeHistory, 1000); }
app.on('before-quit', writeHistory);

function addHistory(url, title) {
  if (!/^https?:/i.test(url)) return;
  if (historyList[0] && historyList[0].url === url) return;
  if (wakingUrls.delete(url)) return;
  historyList.unshift({ url, title: title || url, time: Date.now() });
  if (historyList.length > 5000) historyList.length = 5000;
  saveHistory();
}
function updateHistoryTitle(url, title) {
  const e = historyList.find((h) => h.url === url);
  if (e && title) { e.title = title; saveHistory(); }
}

ipcMain.handle('history-get', (event) => (fromHistoryPage(event) ? historyList : []));
ipcMain.handle('history-remove', (_e, time, url) => {
  if (!fromHistoryPage(_e)) return [];
  historyList = historyList.filter((h) => !(h.time === time && h.url === url));
  saveHistory();
  return historyList;
});
ipcMain.handle('history-clear', (event) => { if (!fromHistoryPage(event)) return []; historyList = []; saveHistory(); return historyList; });
ipcMain.on('history-open', (_e, url) => { if (fromHistoryPage(_e) && /^https?:/i.test(url)) createTab(url); });

function openHistoryTab() {
  const url = require('url').pathToFileURL(path.join(__dirname, 'history.html')).href;
  const open = tabs.find((t) => !t.view.webContents.isDestroyed() && t.view.webContents.getURL() === url);
  if (open) switchTab(open.id); else openInternalTab(url);
}

// MODO_COMPACTO: la altura de la barra de arriba depende del ajuste
function topH() { return (settings && settings.compact === true) ? 62 : TOP_HEIGHT; }
function tabbarH() { return (settings && settings.compact === true) ? 32 : 40; }
function compactoRelayout() {
  const prev = curCtx;
  if (WINS.length) {
    WINS.slice().forEach((x) => { try { useCtx(x); updateOverlayOne(); resizeView(); } catch (e) {} });
    if (prev && WINS.includes(prev)) useCtx(prev);
  } else { try { updateOverlayOne(); resizeView(); } catch (e) {} }
}
// CARPETA_DESCARGAS: carpeta elegida por el usuario (si no existe, la de Windows)
function carpetaDescargas() {
  try {
    const d = settings && settings.downloadsDir;
    if (typeof d === 'string' && d && fs.statSync(d).isDirectory()) return d;
  } catch (e) {}
  return app.getPath('downloads');
}
function applySettings() {
  try { compactoRelayout(); } catch (e) {}
  nativeTheme.themeSource = 'system';
  const dest = (typeof WINS !== 'undefined' && WINS.length) ? WINS.map((c) => c.win) : [win]; // TEMA_TODAS
  dest.forEach((w) => { try { if (w && !w.isDestroyed()) w.webContents.send('settings-changed', settings); } catch (e) {} });
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch (e) {}
}
ipcMain.handle('get-settings', () => settings);
ipcMain.on('toggle-adblock', () => { settings.adblock = (settings.adblock === false); applySettings(); }); // ADBLOCK_BOTON

ipcMain.on('open-menu', () => {
  const menu = Menu.buildFromTemplate([
    { label: tr('history'), click: () => openHistoryTab() },
    { label: tr('downloads'), click: () => openDownloadsTab() },
    { label: tr('print'), click: () => printActiveTab() },
    { type: 'separator' },
    { label: permLang().reset, click: () => resetPermissions() },
    { label: (settings.language === 'es' ? 'Protecci\u00f3n contra la huella digital' : 'Fingerprinting protection'), type: 'checkbox', checked: settings.fingerprint !== false, click: (item) => { settings.fingerprint = item.checked; applySettings(); } },
    { label: 'Language / Idioma', submenu: [ { label: 'English', type: 'radio', checked: settings.language !== 'es', click: () => setLanguage('en') }, { label: 'Espa\u00f1ol', type: 'radio', checked: settings.language === 'es', click: () => setLanguage('es') } ] },
    { label: tr('showDownloadsIcon'), type: 'checkbox', checked: settings.showDownloads !== false, click: (item) => { settings.showDownloads = item.checked; applySettings(); } },
  ]);
  menu.popup({ window: win });
});

// ---------- Imprimir ----------
function printActiveTab() {
  const tab = activeTab();
  if (!tab || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.print({ printBackground: true });
}

// ---------- Reordenar pestañas ----------
ipcMain.on('reorder-tabs', (_event, ids) => {
  if (!Array.isArray(ids)) return;
  const order = ids.map(Number);
  tabs.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
  });
  sendTabs();
});

// ---------- Suspender pestañas inactivas ----------
// Por defecto, a los 10 minutos. Para probar: $env:STILL_SUSPEND_MIN = '0.5' antes de npm start
const SUSPEND_AFTER_MS = (Number(process.env.STILL_SUSPEND_MIN) || 10) * 60 * 1000;
const wakingUrls = new Set();

function wakeTab(tab) {
  if (!tab || !tab.suspended) return;
  tab.suspended = false;
  tab.lastActive = Date.now();
  const wc = tab.view.webContents;
  if (!wc.isDestroyed()) {
    const url = wc.getURL();
    wakingUrls.add(url);
    setTimeout(() => wakingUrls.delete(url), 15000);
    wc.reload();
  }
  sendTabs();
}

function canSuspend(tab) {
  if (tab.suspended || tab.id === activeId) return false;
  const wc = tab.view.webContents;
  if (wc.isDestroyed() || wc.isCrashed()) return false;
  if (!/^https?:/i.test(wc.getURL())) return false;
  if (wc.isLoading() || wc.isCurrentlyAudible() || wc.isAudioMuted()) return false;
  if (wc.isDevToolsOpened()) return false;
  if (typeof wc.isBeingCaptured === 'function' && wc.isBeingCaptured()) return false;
  return true;
}

function suspendTab(tab) {
  tab.suspended = true;
  tab.view.webContents.forcefullyCrashRenderer();
  sendTabs();
}

// Al cambiar de pestaña, despierta la nueva al instante
const switchTabOriginal = switchTab;
switchTab = function (id) {
  switchTabOriginal(id);
  wakeTab(tabs.find((t) => t.id === id));
};

// Red de seguridad: la pestaña activa nunca debe estar dormida
setInterval(() => {
  const active = activeTab();
  if (active) { active.lastActive = Date.now(); wakeTab(active); }
}, 1500);

// Cada 15 s, duerme las pestañas que llevan tiempo sin usarse
setInterval(() => {
  const now = Date.now();
  tabs.forEach((t) => {
    if (!t.lastActive) t.lastActive = now;
    if (canSuspend(t) && now - t.lastActive > SUSPEND_AFTER_MS) suspendTab(t);
  });
}, 15000);

// ---------- Corrector ortografico desactivado ----------
app.whenReady().then(() => {
  try { session.defaultSession.setSpellCheckerEnabled(false); } catch (e) {}
});

// ---------- Restaurar pestanas al abrir ----------
const sessionFile = path.join(app.getPath('userData'), 'session.json');
let sessionLocked = false;
let sessionTimer = null;

function collectSession() {
  const tabs = allWindowTabs();
  const activeId = mainActiveId();
  const list = [];
  let active = 0;
  tabs.forEach((t) => {
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return;
    let url, title, favicon;
    if (t.pendingUrl) {
      url = t.pendingUrl; title = t.savedTitle; favicon = t.savedFavicon;
    } else {
      url = wc.getURL(); title = wc.getTitle(); favicon = t.favicon;
    }
    if (t.id === activeId) active = list.length;
    list.push({
      url: /^https?:/i.test(url || '') ? url : '',
      title: String(title || '').slice(0, 200),
      favicon: (typeof favicon === 'string' && favicon.length < 20000) ? favicon : ''
    });
  });
  if (!list.some((s) => s.url)) return { tabs: [], active: 0 };
  return { tabs: list, active };
}

function saveSessionNow() {
  if (sessionLocked || tabs.length === 0) return;
  try { fs.writeFileSync(sessionFile, JSON.stringify(collectSession())); } catch (e) {}
}
function scheduleSessionSave() {
  if (sessionLocked) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 1500);
}
app.on('browser-window-created', (_e, w) => {
  w.on('close', () => { if (WINS.filter((c) => { try { return !c.win.isDestroyed(); } catch (e) { return false; } }).length > 1) return; saveSessionNow(); sessionLocked = true; });
});

const sendTabsOriginal = sendTabs;
sendTabs = function () { sendTabsOriginal(); scheduleSessionSave(); };

// Una pestana restaurada y dormida se carga al despertarla
const wakeTabOriginal = wakeTab;
wakeTab = function (tab) {
  if (tab && tab.suspended && tab.pendingUrl) {
    const url = tab.pendingUrl;
    tab.pendingUrl = null;
    tab.suspended = false;
    tab.lastActive = Date.now();
    wakingUrls.add(url);
    setTimeout(() => wakingUrls.delete(url), 15000);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(url);
    sendTabs();
    return;
  }
  wakeTabOriginal(tab);
};

// INICIO_CONFIGURABLE: que abrir al arrancar (continue / home / page)
function startupTarget() {
  if (settings.startup === 'page') {
    let u = '';
    try { u = normalizeUrl(settings.startupUrl || ''); } catch (e) {}
    if (/^https?:\/\//i.test(u || '')) return u;
  }
  return HOME;
}

function restoreSession() {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch (e) {}
  const list = (data && Array.isArray(data.tabs))
    ? data.tabs.filter((s) => s && typeof s.url === 'string').slice(0, 30)
    : [];
  if (settings.startup === 'home' || settings.startup === 'page') { createTab(startupTarget()); return; }
    if (!list.length) { createTab(HOME); return; }
  const activeIdx = Math.min(Math.max(Number(data.active) || 0, 0), list.length - 1);
  list.forEach((s, i) => {
    const real = /^https?:/i.test(s.url);
    if (i === activeIdx || !real) {
      createTab(real ? s.url : HOME);
    } else {
      createTab('about:blank');
      const tab = tabs[tabs.length - 1];
      tab.suspended = true;
      tab.pendingUrl = s.url;
      tab.savedTitle = s.title || s.url;
      tab.savedFavicon = s.favicon || '';
    }
  });
  if (tabs[activeIdx]) switchTab(tabs[activeIdx].id);
}

// ---------- Descargas ----------
const electronExtra = require('electron');
const downloadsFile = path.join(app.getPath('userData'), 'downloads.json');
let downloadsList = [];
try { downloadsList = JSON.parse(fs.readFileSync(downloadsFile, 'utf8')); } catch (e) {}
downloadsList.forEach((d) => { if (d.state === 'progressing' || d.state === 'paused') d.state = 'interrupted'; });
const downloadItems = new Map();
let downloadsTimer = null;
function writeDownloads() { try { fs.writeFileSync(downloadsFile, JSON.stringify(downloadsList)); } catch (e) {} }
function saveDownloads() { clearTimeout(downloadsTimer); downloadsTimer = setTimeout(writeDownloads, 1000); }
app.on('before-quit', writeDownloads);

function uniqueDownloadPath(name) {
  const dir = carpetaDescargas(); // CARPETA_DESCARGAS
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  let n = 1;
  while (fs.existsSync(p)) { p = path.join(dir, base + ' (' + n + ')' + ext); n++; }
  return p;
}

app.whenReady().then(() => {
  session.defaultSession.on('will-download', (_event, item) => {
    const savePath = uniqueDownloadPath(path.basename(item.getFilename() || 'descarga'));
    const wasAsked = item.getURLChain().some((u) => askSave.delete(u)) || settings.askSaveDownloads === true; // PREGUNTAR_DONDE_GUARDAR
    if (!wasAsked) item.setSavePath(savePath); else { try { item.setSaveDialogOptions({ defaultPath: savePath }); } catch (e) {} } // CARPETA_DESCARGAS
    const entry = {
      id: Date.now().toString() + Math.floor(Math.random() * 1000),
      name: path.basename(savePath),
      url: item.getURL(),
      path: savePath,
      total: item.getTotalBytes(),
      received: 0,
      state: 'progressing',
      start: Date.now(),
      end: 0
    };
    downloadsList.unshift(entry);
    if (downloadsList.length > 500) downloadsList.length = 500;
    downloadItems.set(entry.id, item);
    item.on('updated', (_e, state) => {
      if (wasAsked) syncChosen(item, entry);
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
    });
    item.once('done', (_e, state) => {
      if (wasAsked) {
        syncChosen(item, entry);
        if (state === 'cancelled' && !item.getSavePath()) downloadsList = downloadsList.filter((x) => x.id !== entry.id);
      }
      entry.received = item.getReceivedBytes();
      entry.state = state;
      entry.end = Date.now();
      downloadItems.delete(entry.id);
      saveDownloads();
      if (state === 'completed') {
        try { new electronExtra.Notification({ title: tr('downloadDone'), body: entry.name }).show(); } catch (e) {}
      }
    });
    saveDownloads();
  });
});

function fromDownloadsPage(event) { return String(event.sender.getURL()) === DOWNLOADS_URL; }
ipcMain.handle('downloads-get', (event) => (fromDownloadsPage(event) ? downloadsList : []));
ipcMain.handle('downloads-open', async (event, id) => {
  if (!fromDownloadsPage(event)) return '';
  const d = downloadsList.find((x) => x.id === id);
  if (!d) return 'No existe';
  return await electronExtra.shell.openPath(d.path);
});
ipcMain.on('downloads-show', (event, id) => {
  if (!fromDownloadsPage(event)) return;
  const d = downloadsList.find((x) => x.id === id);
  if (d) electronExtra.shell.showItemInFolder(d.path);
});
ipcMain.on('downloads-cancel', (event, id) => {
  if (!fromDownloadsPage(event)) return;
  const it = downloadItems.get(id);
  if (it) it.cancel();
});
ipcMain.handle('downloads-remove', (event, id) => {
  if (!fromDownloadsPage(event)) return [];
  if (downloadItems.has(id)) return downloadsList;
  downloadsList = downloadsList.filter((x) => x.id !== id);
  saveDownloads();
  return downloadsList;
});
ipcMain.handle('downloads-clear', (event) => {
  if (!fromDownloadsPage(event)) return [];
  downloadsList = downloadsList.filter((x) => downloadItems.has(x.id));
  saveDownloads();
  return downloadsList;
});

function openDownloadsTab() {
  try { (WINS.length ? WINS.map((c) => c.win) : [win]).forEach((w) => { try { if (w && !w.isDestroyed()) w.webContents.send('downloads-seen'); } catch (e) {} }); } catch (e) {} // DESCARGAS_AUTO_2
  const url = require('url').pathToFileURL(path.join(__dirname, 'downloads.html')).href;
  const open = tabs.find((t) => !t.view.webContents.isDestroyed() && t.view.webContents.getURL() === url);
  if (open) switchTab(open.id); else openInternalTab(url);
}

ipcMain.on('open-downloads', () => openDownloadsTab());

// AJUSTES_PAGINA: pagina de ajustes (settings.html), se abre en una pestana como la de descargas
function openSettingsTab() {
  const open = tabs.find((t) => !t.view.webContents.isDestroyed() && String(t.view.webContents.getURL()).split('#')[0] === SETTINGS_PAGE_URL);
  if (open) switchTab(open.id); else openInternalTab(SETTINGS_PAGE_URL);
}
ipcMain.on('open-settings', () => openSettingsTab());

function isSettingsSender(event) {
  try { return String(event.sender.getURL()).split('#')[0] === SETTINGS_PAGE_URL; } catch (e) { return false; }
}
function settingsPageState() {
  return {
    searchEngine: SEARCH_ENGINES[settings.searchEngine] ? settings.searchEngine : 'duckduckgo',
    engines: Object.keys(SEARCH_ENGINES).map((k) => ({ id: k, name: SEARCH_ENGINES[k].name })),
    fingerprint: settings.fingerprint !== false,
    showDownloads: settings.showDownloads !== false,
    roundedFrame: settings.roundedFrame !== false, downloadsAuto: settings.downloadsAuto === true, compact: settings.compact === true, showExtensions: settings.showExtensions !== false, showExtButton: settings.showExtButton !== false, hiddenExtensions: Array.isArray(settings.hiddenExtensions) ? settings.hiddenExtensions : [], /* EXT_PIN */ /* EXTENSIONES_APARIENCIA */ askSaveDownloads: settings.askSaveDownloads === true, downloadsDir: carpetaDescargas(), downloadsDirCustom: !!(settings.downloadsDir), hardwareAcceleration: settings.hardwareAcceleration !== false, startup: (settings.startup === 'home' || settings.startup === 'page') ? settings.startup : 'continue', startupUrl: settings.startupUrl || '',
    language: settings.language === 'es' ? 'es' : 'en'
  };
}
ipcMain.handle('settings-page-get', (event) => (isSettingsSender(event) ? settingsPageState() : null));
// NAVEGADOR_PREDETERMINADO: abre la pantalla de Windows para elegir el navegador predeterminado
ipcMain.handle('settings-open-default-apps', (event) => {
  if (!isSettingsSender(event)) return false;
  require('electron').shell.openExternal('ms-settings:defaultapps?registeredAppUser=Still%20Browser').catch(() => {});
  return true;
});
ipcMain.handle('settings-pick-downloads-dir', async (event) => { // CARPETA_DESCARGAS
  if (!isSettingsSender(event)) return null;
  const par = win;
  try {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(par, { properties: ['openDirectory', 'createDirectory'], defaultPath: carpetaDescargas() });
    if (!r.canceled && r.filePaths && r.filePaths[0]) { settings.downloadsDir = r.filePaths[0]; applySettings(); }
  } catch (e) {}
  return settingsPageState();
});
ipcMain.handle('settings-page-set', (event, key, value) => {
  if (!isSettingsSender(event)) return null;
  if (key === 'searchEngine' && SEARCH_ENGINES[value]) { settings.searchEngine = value; applySettings(); }
  else if (key === 'fingerprint') { settings.fingerprint = (value === true); applySettings(); }
  else if (key === 'showDownloads') { settings.showDownloads = (value === true); applySettings(); }
  else if (key === 'roundedFrame') { settings.roundedFrame = (value === true); applySettings(); try { updateOverlay(); } catch (e) {} try { relayoutAll(); } catch (e) {} /* MARCO_RELAYOUT */ try { tabs.forEach((t) => applyFrameCss(t)); } catch (e) {} /* MARCO_CSS */ } else if (key === 'downloadsDir' && value === '') { settings.downloadsDir = ''; applySettings(); } /* CARPETA_DESCARGAS */ else if (key === 'askSaveDownloads') { settings.askSaveDownloads = (value === true); applySettings(); } /* PREGUNTAR_DONDE_GUARDAR */ else if (key === 'compact') { settings.compact = (value === true); applySettings(); } else if (key === 'showExtButton') { settings.showExtButton = (value === true); applySettings(); } /* EXT_PIN */ else if (key === 'showExtensions') { settings.showExtensions = (value === true); applySettings(); } /* EXTENSIONES_APARIENCIA */ /* MODO_COMPACTO */ else if (key === 'downloadsAuto') { settings.downloadsAuto = (value === true); applySettings(); } /* DESCARGAS_AUTO */ else if (key === 'hardwareAcceleration') { settings.hardwareAcceleration = (value === true); applySettings(); }
  else if (key === 'language' && (value === 'en' || value === 'es')) { setLanguage(value); }
  else if (key === 'clearOnExit') { settings.clearOnExit = (value === true); applySettings(); } /* AJUSTE_BORRADO */ else if (key === 'cookieMode' && ['todas', 'terceros', 'permitir'].includes(value)) { settings.cookieMode = value; applySettings(); segCookiesCambio(value); } /* AJUSTE_COOKIES */
  else if (key === 'resetPerms') { resetPermissions(); }
  else if (key === 'startup' && (value === 'continue' || value === 'home' || value === 'page')) { settings.startup = value; applySettings(); }
  else if (key === 'startupUrl' && typeof value === 'string') { settings.startupUrl = value.trim().slice(0, 2000); applySettings(); }
  try { sendMenuData(); } catch (e) {}
  return settingsPageState();
});

// ---------- Tema de colores ----------
const THEME_IDS = ['actual', 'grafito', 'oceano', 'bosque', 'violeta', 'ambar', 'rosa'];
function broadcastTheme() {
  const todas = (typeof allWindowTabs === 'function') ? allWindowTabs() : tabs;
  todas.forEach((t) => { try { if (!t.view.webContents.isDestroyed()) t.view.webContents.send('theme-changed', themeWire()); } catch (e) {} });
  return;
  tabs.forEach((t) => {
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.send('theme-changed', themeWire()); } catch (e) {}
  });
}
ipcMain.handle('set-theme', (event, id) => {
  if (!String(event.sender.getURL()).startsWith('file:')) return settings.theme;
  // COLOR_PERSONALIZADO: acepta 'personalizado:#rrggbb'
  const cm = /^personalizado:(#[0-9a-fA-F]{6})$/.exec(String(id));
  if (cm) {
    const hex = cm[1].toLowerCase();
    if (settings.theme === 'personalizado' && settings.customColor === hex) return settings.theme;
    settings.customColor = hex;
    id = 'personalizado';
  } else if (!THEME_IDS.includes(id) || id === settings.theme) {
    return settings.theme;
  }
  settings.theme = id;
  console.log('TEMA:', themeWire(), 'ventanas:', (typeof WINS !== 'undefined') ? WINS.length : 1);
  syncCustomTheme();
  applySettings();
  broadcastTheme();
  updateOverlay();
  return settings.theme;
});

// ---------- Color de los botones de la ventana segun el tema ----------
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}
const OVERLAY_THEMES = {
  grafito: { h: 0, s: 0, l: 7 },
  oceano: { h: 215, s: 35, l: 12 },
  bosque: { h: 150, s: 28, l: 11 },
  violeta: { h: 265, s: 32, l: 13 },
  ambar: { h: 30, s: 35, l: 12 },
  rosa: { h: 335, s: 32, l: 13 }
};
// COLOR_PERSONALIZADO: convierte el color elegido en tono/saturacion como los demas temas
function customHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const s = sat < 0.08 ? 0 : Math.round(Math.min(45, 15 + sat * 30));
  return { h: Math.round(h), s: s, l: Math.round(7 + l * 15) };
}
function syncCustomTheme() {
  if (settings.customColor && /^#[0-9a-f]{6}$/i.test(settings.customColor)) OVERLAY_THEMES.personalizado = customHsl(settings.customColor);
  else delete OVERLAY_THEMES.personalizado;
}
function themeWire() {
  return (settings.theme === 'personalizado' && settings.customColor) ? 'personalizado:' + settings.customColor : settings.theme;
}
syncCustomTheme();

function updateOverlayOne() {
  if (!win || win.isDestroyed()) return;
  const t = OVERLAY_THEMES[settings.theme];
  const color = t ? hslHex(t.h, t.s, t.l + 5) : '#292a2d';
  const symbolColor = t ? hslHex(t.h, Math.min(t.s, 15), 80) : '#cccccc';
  try { win.setBackgroundColor(color); } catch (e) {}
  try { win.setTitleBarOverlay({ color: color, symbolColor: symbolColor, height: tabbarH() }); } catch (e) {}
}

// ---------- Idioma ----------
const MAIN_TEXT = {
  en: { newTab: 'New tab', history: 'History', downloads: 'Downloads', print: 'Print', showDownloadsIcon: 'Show downloads icon', downloadDone: 'Download complete' },
  es: { newTab: 'Nueva pesta\u00f1a', history: 'Historial', downloads: 'Descargas', print: 'Imprimir', showDownloadsIcon: 'Mostrar icono de descargas', downloadDone: 'Descarga completada' }
};
function tr(key) {
  const l = settings.language === 'es' ? 'es' : 'en';
  return MAIN_TEXT[l][key];
}
ipcMain.handle('get-language', () => (settings.language === 'es' ? 'es' : 'en'));

// PANEL_PERSONALIZAR: preferencias del panel de la pantalla de inicio
function startPrefs() {
  return { showDownloads: settings.showDownloads !== false };
}

function broadcastPrefs() {
  tabs.forEach((t) => {
    try {
      if (!t.view.webContents.isDestroyed()) {
        t.view.webContents.send('prefs-changed', startPrefs());
      }
    } catch (e) {}
  });
}

ipcMain.handle('start-get-prefs', (event) => {
  return fromStartPage(event) ? startPrefs() : null;
});

ipcMain.handle('start-set-pref', (event, key, value) => {
  if (!fromStartPage(event)) return null;

  if (key === 'showDownloads') {
    settings.showDownloads = (value === true);
    applySettings();
  }

  broadcastPrefs();

  try { sendMenuData(); } catch (e) {}

  return startPrefs();
});
function setLanguage(lang) {
  settings.language = lang === 'es' ? 'es' : 'en';
  applySettings();
  tabs.forEach((t) => {
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.send('language-changed', settings.language); } catch (e) {}
  });
  sendTabs();
}
// ---------- Aviso visual de descargas en curso ----------
let lastDlKey = '';
let lastFlashId = '';
setInterval(() => {
  if (!win || win.isDestroyed()) return;
  const act = downloadsList.filter((d) => d.state === 'progressing' || d.state === 'paused');
  let progress = -1;
  if (act.length && act.every((d) => d.total > 0)) {
    const tot = act.reduce((a, d) => a + d.total, 0);
    const rec = act.reduce((a, d) => a + d.received, 0);
    progress = tot > 0 ? Math.min(1, rec / tot) : -1;
  }
  const fresh = act.length === 0
    ? downloadsList.find((d) => d.state === 'completed' && d.end && Date.now() - d.end < 3000 && d.id !== lastFlashId)
    : null;
  const completed = !!fresh;
  if (fresh) lastFlashId = fresh.id;
  const key = act.length + '|' + progress.toFixed(2) + '|' + completed;
  if (key === lastDlKey) return;
  lastDlKey = key;
  try { win.setProgressBar(act.length ? (progress >= 0 ? progress : 2) : -1); } catch (e) {}
  try { win.webContents.send('downloads-state', { active: act.length, progress: progress, completed: completed }); } catch (e) {}
}, 400);

// ---------- Menu del boton derecho ----------
const askSave = new Set();
const CTX_TEXT = {
  en: {
    openLinkNewTab: 'Open link in new tab', copyLink: 'Copy link address', saveLinkAs: 'Save link as...',
    openImageNewTab: 'Open image in new tab', saveImageAs: 'Save image as...', copyImage: 'Copy image', copyImageAddress: 'Copy image address',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', search: 'Search DuckDuckGo for "%s"',
    back: 'Back', forward: 'Forward', reload: 'Reload', print: 'Print...'
  },
  es: {
    openLinkNewTab: 'Abrir enlace en una pesta\u00f1a nueva', copyLink: 'Copiar direcci\u00f3n de enlace', saveLinkAs: 'Guardar enlace como...',
    openImageNewTab: 'Abrir imagen en una pesta\u00f1a nueva', saveImageAs: 'Guardar imagen como...', copyImage: 'Copiar imagen', copyImageAddress: 'Copiar direcci\u00f3n de imagen',
    cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo', search: 'Buscar en DuckDuckGo "%s"',
    back: 'Atr\u00e1s', forward: 'Adelante', reload: 'Recargar', print: 'Imprimir...'
  }
};

function syncChosen(item, entry) {
  const chosen = item.getSavePath();
  if (chosen) { entry.path = chosen; entry.name = path.basename(chosen); }
}

function askDownload(wc, url) {
  askSave.add(url);
  setTimeout(() => askSave.delete(url), 10000);
  wc.downloadURL(url);
}

function addContextMenu(wc) {
  wc.on('context-menu', (_event, params) => {
    const clip = require('electron').clipboard;
    if (String(wc.getURL()).startsWith('file:') && !params.isEditable) return;
    const t = CTX_TEXT[settings.language || 'es'] || CTX_TEXT.es;
    const items = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
    const link = /^https?:/i.test(params.linkURL || '') ? params.linkURL : '';
    const img = (params.mediaType === 'image' && /^(https?:|data:image\/)/i.test(params.srcURL || '')) ? params.srcURL : '';
    const sel = String(params.selectionText || '').trim();

    if (link) {
      items.push({ label: t.openLinkNewTab, click: () => createTab(link) });
      sep();
      items.push({ label: t.copyLink, click: () => clip.writeText(link) });
      items.push({ label: t.saveLinkAs, click: () => askDownload(wc, link) });
    }
    if (img) {
      sep();
      items.push({ label: t.openImageNewTab, click: () => createTab(img) });
      items.push({ label: t.saveImageAs, click: () => askDownload(wc, img) });
      items.push({ label: t.copyImage, click: () => wc.copyImageAt(params.x, params.y) });
      items.push({ label: t.copyImageAddress, click: () => clip.writeText(img) });
    }
    if (params.isEditable) {
      sep();
      items.push({ label: t.cut, enabled: !!params.editFlags.canCut, click: () => wc.cut() });
      items.push({ label: t.copy, enabled: !!params.editFlags.canCopy, click: () => wc.copy() });
      items.push({ label: t.paste, enabled: !!params.editFlags.canPaste, click: () => wc.paste() });
      items.push({ label: t.selectAll, enabled: !!params.editFlags.canSelectAll, click: () => wc.selectAll() });
    } else if (sel) {
      sep();
      items.push({ label: t.copy, click: () => wc.copy() });
      const shown = sel.length > 30 ? sel.slice(0, 30) + '...' : sel;
      items.push({ label: t.search.replace('%s', shown).replace('DuckDuckGo', searchEngine().name), click: () => createTab(searchUrl(sel)) });
    }
    if (!link && !img && !params.isEditable && !sel) {
      items.push({ label: t.back, enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      items.push({ label: t.forward, enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      items.push({ label: t.reload, click: () => wc.reload() });
      sep();
      items.push({ label: t.print, click: () => printActiveTab() });
    }
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

// ---------- Paginas propias del navegador (direccion exacta) ----------
const HISTORY_URL = pathToFileURL(path.join(__dirname, 'history.html')).href;
const DOWNLOADS_URL = pathToFileURL(path.join(__dirname, 'downloads.html')).href;
function fromHistoryPage(event) { return String(event.sender.getURL()) === HISTORY_URL; }

// ---------- Permisos de las webs ----------
const permsFile = path.join(app.getPath('userData'), 'permissions.json');
let perms = {};
try { perms = JSON.parse(fs.readFileSync(permsFile, 'utf8')) || {}; } catch (e) { perms = {}; }
function savePerms() { try { fs.writeFileSync(permsFile, JSON.stringify(perms)); } catch (e) {} }
function resetPermissions() { perms = {}; savePerms(); }

const PERM_ALLOW = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock'];
const PERM_ASK = ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex', 'idle-detection'];
const PERM_TEXT = {
  en: {
    title: 'Permission request', wants: 'wants to:', allow: 'Allow', block: 'Block',
    remember: 'Remember my choice for this site', reset: 'Reset site permissions',
    camera: 'Use your camera', mic: 'Use your microphone', cameraMic: 'Use your camera and microphone',
    geolocation: 'Know your location', notifications: 'Show notifications',
    'clipboard-read': 'See text and images you copied', midi: 'Use your MIDI devices', midiSysex: 'Use your MIDI devices',
    'idle-detection': 'Know when you are using this device'
  },
  es: {
    title: 'Solicitud de permiso', wants: 'quiere:', allow: 'Permitir', block: 'Bloquear',
    remember: 'Recordar mi decisi\u00f3n para este sitio', reset: 'Restablecer permisos de sitios',
    camera: 'Usar tu c\u00e1mara', mic: 'Usar tu micr\u00f3fono', cameraMic: 'Usar tu c\u00e1mara y tu micr\u00f3fono',
    geolocation: 'Conocer tu ubicaci\u00f3n', notifications: 'Mostrar notificaciones',
    'clipboard-read': 'Ver el texto y las im\u00e1genes que has copiado', midi: 'Usar tus dispositivos MIDI', midiSysex: 'Usar tus dispositivos MIDI',
    'idle-detection': 'Saber cu\u00e1ndo usas este dispositivo'
  }
};
function permLang() { return PERM_TEXT[settings.language || 'es'] || PERM_TEXT.es; }

function permKey(origin, permission, details) {
  if (permission === 'media') {
    const types = (details && details.mediaTypes && details.mediaTypes.length) ? details.mediaTypes.slice().sort().join('+') : 'any';
    return origin + '|media:' + types;
  }
  return origin + '|' + permission;
}

let permQueue = Promise.resolve();
const permPending = new Map();
function askPermission(origin, permission, details) {
  const key = permKey(origin, permission, details);
  if (Object.prototype.hasOwnProperty.call(perms, key)) return Promise.resolve(perms[key]);
  if (permPending.has(key)) return permPending.get(key);
  const p = permQueue.then(async () => {
    if (Object.prototype.hasOwnProperty.call(perms, key)) return perms[key];
    const t = permLang();
    let what = t[permission] || permission;
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || [];
      const v = types.includes('video');
      const a = types.includes('audio');
      what = (v && a) ? t.cameraMic : (v ? t.camera : (a ? t.mic : t.cameraMic));
    }
    let host = origin;
    try { host = new URL(origin).host; } catch (e) {}
    const r = await require('electron').dialog.showMessageBox((win && !win.isDestroyed()) ? win : undefined, {
      type: 'question',
      buttons: [t.allow, t.block],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: t.title,
      message: host + ' ' + t.wants,
      detail: what,
      checkboxLabel: t.remember,
      checkboxChecked: false
    });
    const ok = r.response === 0;
    if (r.checkboxChecked) { perms[key] = ok; savePerms(); }
    return ok;
  }).catch(() => false);
  permQueue = p.then(() => {}, () => {});
  permPending.set(key, p);
  p.then(() => permPending.delete(key), () => permPending.delete(key));
  return p;
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'clipboard-sanitized-write') return callback(true); // CLIPBOARD_COPIAR
    let url = (details && details.requestingUrl) || '';
    try { if (!url && wc) url = wc.getURL(); } catch (e) {}
    if (String(url).startsWith('file:')) return callback(true);
    if (PERM_ALLOW.includes(permission)) return callback(true);
    if (!PERM_ASK.includes(permission)) return callback(false);
    let origin = '';
    try { origin = new URL(url).origin; } catch (e) {}
    if (!/^https?:/i.test(origin)) return callback(false);
    askPermission(origin, permission, details).then((ok) => callback(!!ok), () => callback(false));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const origin = String(requestingOrigin || '');
    if (origin.startsWith('file:')) return true;
    if (PERM_ALLOW.includes(permission)) return true;
    if (PERM_DEVICES.includes(permission)) return /^https?:/i.test(origin); // DISPOSITIVOS_ELEGIR
    if (!PERM_ASK.includes(permission)) return false;
    if (permission === 'media') {
      const mt = details && details.mediaType;
      return Object.keys(perms).some((k) => k.startsWith(origin + '|media:') && perms[k] === true && (!mt || mt === 'unknown' || k.includes(mt)));
    }
    return perms[origin + '|' + permission] === true;
  });
});


// DISPOSITIVOS_ELEGIR: ventana para elegir dispositivo (HID, USB, Bluetooth y puerto serie)
const PERM_DEVICES = ['hid', 'usb', 'serial', 'bluetooth'];
const DSP_TEXT = {
  en: {
    hid: 'Select a HID device', usb: 'Select a USB device', serial: 'Select a serial port', bluetooth: 'Select a Bluetooth device',
    wants: 'wants to connect to a device', empty: 'No compatible devices found. Make sure it is connected.',
    searching: 'Searching for devices...', connect: 'Connect', cancel: 'Cancel'
  },
  es: {
    hid: 'Elige un dispositivo HID', usb: 'Elige un dispositivo USB', serial: 'Elige un puerto serie', bluetooth: 'Elige un dispositivo Bluetooth',
    wants: 'quiere conectarse a un dispositivo', empty: 'No se ha encontrado ning\u00fan dispositivo compatible. Comprueba que est\u00e1 conectado.',
    searching: 'Buscando dispositivos...', connect: 'Conectar', cancel: 'Cancelar'
  }
};
let dspView = null;
let dspReady = null;
let dspCurrent = null;
let dspHooked = false;
let dspClosedAt = 0;

function dspHex(n) { return (typeof n === 'number') ? n.toString(16).padStart(4, '0') : ''; }

function dspList(kind, raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((d) => {
    let id = '';
    let name = '';
    if (kind === 'bluetooth') { id = d.deviceId; name = d.deviceName; }
    else if (kind === 'serial') { id = d.portId; name = d.displayName || d.portName; }
    else if (kind === 'usb') { id = d.deviceId; name = d.productName || d.manufacturerName; }
    else { id = d.deviceId; name = d.name || d.productName; }
    const extra = (typeof d.vendorId === 'number' && typeof d.productId === 'number') ? (dspHex(d.vendorId) + ':' + dspHex(d.productId)) : '';
    if (!id) return;
    out.push({ id: String(id), name: String(name || (kind === 'bluetooth' ? 'Bluetooth' : kind.toUpperCase())), extra: extra });
  });
  return out;
}

function dspHost(wc, details) {
  let url = '';
  try { if (details && details.frame && details.frame.url) url = details.frame.url; } catch (e) {}
  try { if (!url && wc) url = wc.getURL(); } catch (e) {}
  try { if (!url) { const t = activeTab(); if (t) url = t.view.webContents.getURL(); } } catch (e) {}
  try { return new URL(url).host; } catch (e) { return ''; }
}

function dspAnswer(cur, id) {
  try {
    if (id) cur.callback(id);
    else if (cur.kind === 'serial' || cur.kind === 'bluetooth') cur.callback('');
    else cur.callback();
  } catch (e) {}
}

function dspEnsureView() {
  if (dspView && !dspView.webContents.isDestroyed()) return dspView;
  dspView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'devices-preload.js'), sandbox: true } });
  dspView.setBackgroundColor('#00000000');
  dspView.setVisible(false);
  win.contentView.addChildView(dspView);
  dspReady = new Promise((resolve) => dspView.webContents.once('did-finish-load', resolve));
  dspView.webContents.loadFile(path.join(__dirname, 'devices.html'));
  if (!dspHooked) {
    dspHooked = true;
    win.on('resize', () => {
      try {
        if (dspCurrent && dspView && !dspView.webContents.isDestroyed()) {
          const s = win.getContentSize();
          dspView.setBounds({ x: 0, y: 0, width: s[0], height: s[1] });
        }
      } catch (e) {}
    });
  }
  return dspView;
}

function dspSend() {
  if (!dspCurrent || !dspView || dspView.webContents.isDestroyed()) return;
  const es = settings.language === 'es';
  try {
    dspView.webContents.send('devices-data', {
      theme: menuColors(), text: DSP_TEXT[es ? 'es' : 'en'],
      kind: dspCurrent.kind, host: dspCurrent.host, devices: dspCurrent.devices
    });
  } catch (e) {}
}

async function dspOpen() {
  try {
    const v = dspEnsureView();
    await dspReady;
    if (!dspCurrent || !win || win.isDestroyed() || v.webContents.isDestroyed()) return;
    const s = win.getContentSize();
    v.setBounds({ x: 0, y: 0, width: s[0], height: s[1] });
    dspSend();
    v.setVisible(true);
    win.contentView.addChildView(v);
    v.webContents.focus();
  } catch (e) { console.log('Dispositivos:', e.message); }
}

function dspClose(id) {
  const cur = dspCurrent;
  dspCurrent = null;
  dspClosedAt = Date.now();
  try { if (dspView && !dspView.webContents.isDestroyed()) dspView.setVisible(false); } catch (e) {}
  if (cur) dspAnswer(cur, id);
  try { const tab = activeTab(); if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus(); } catch (e) {}
}

function dspRequest(kind, wc, details, rawList, callback) {
  const devices = dspList(kind, rawList);
  const nuevo = { kind: kind, callback: callback };
  if (!win || win.isDestroyed()) { dspAnswer(nuevo, ''); return; }
  if (kind === 'bluetooth' && Date.now() - dspClosedAt < 1500) { dspAnswer(nuevo, ''); return; }
  if (dspCurrent && kind === 'bluetooth' && dspCurrent.kind === 'bluetooth' && dspCurrent.wc === wc) {
    dspCurrent.devices = devices;
    dspCurrent.callback = callback;
    dspSend();
    return;
  }
  if (dspCurrent) { dspAnswer(nuevo, ''); return; }
  dspCurrent = { kind: kind, wc: wc, host: dspHost(wc, details), devices: devices, callback: callback };
  dspOpen();
}

ipcMain.on('devices-choose', (event, id) => {
  if (!dspView || dspView.webContents.isDestroyed() || event.sender !== dspView.webContents || !dspCurrent) return;
  const ok = dspCurrent.devices.some((d) => d.id === String(id));
  dspClose(ok ? String(id) : '');
});
ipcMain.on('devices-cancel', (event) => {
  if (!dspView || dspView.webContents.isDestroyed() || event.sender !== dspView.webContents) return;
  dspClose('');
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('select-bluetooth-device', (event, deviceList, callback) => {
    try { event.preventDefault(); } catch (e) {}
    dspRequest('bluetooth', wc, null, deviceList, callback);
  });
});
app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    dspRequest('hid', null, details, details && details.deviceList, callback);
  });
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    dspRequest('usb', null, details, details && details.deviceList, callback);
  });
  ses.on('select-serial-port', (event, portList, wc, callback) => {
    event.preventDefault();
    dspRequest('serial', wc, null, portList, callback);
  });
});

// ---------- Atajos de teclado y zoom ----------
const zoomFile = path.join(app.getPath('userData'), 'zoom.json');
let zoomMap = {};
try { zoomMap = JSON.parse(fs.readFileSync(zoomFile, 'utf8')) || {}; } catch (e) { zoomMap = {}; }
function saveZoom() { try { fs.writeFileSync(zoomFile, JSON.stringify(zoomMap)); } catch (e) {} }
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function zoomHost(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : '';
  } catch (e) { return ''; }
}
function applySavedZoom(wc) {
  try {
    if (wc.isDestroyed()) return;
    const host = zoomHost(wc.getURL());
    wc.setZoomFactor((host && zoomMap[host]) || 1);
  } catch (e) {}
}
function setZoom(wc, factor) {
  try {
    factor = Math.min(5, Math.max(0.25, factor));
    showZoomIndicator(factor);
    wc.setZoomFactor(factor);
    const host = zoomHost(wc.getURL());
    if (host) {
      if (Math.abs(factor - 1) < 0.001) delete zoomMap[host]; else zoomMap[host] = factor;
      saveZoom();
    }
  } catch (e) {}
}
function zoomBy(wc, dir) {
  const cur = wc.getZoomFactor();
  let next;
  if (dir > 0) next = ZOOM_STEPS.find((s) => s > cur + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
  else next = ZOOM_STEPS.slice().reverse().find((s) => s < cur - 0.001) || ZOOM_STEPS[0];
  setZoom(wc, next);
}

function focusAddressBar() {
  if (!win || win.isDestroyed()) return;
  win.webContents.focus();
  win.webContents.send('focus-address');
}

function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const key = String(input.key || '').toLowerCase();
  const ctrl = !!(input.control || input.meta);
  const tab = activeTab();
  const wc = (tab && !tab.view.webContents.isDestroyed()) ? tab.view.webContents : null;
  let done = true;

  if (key === 'f5' || (ctrl && !input.alt && key === 'r')) {
    if (wc) { if (input.shift || (ctrl && key === 'f5')) wc.reloadIgnoringCache(); else wc.reload(); }
  } else if (ctrl && !input.alt && (key === '+' || key === '=')) {
    if (wc) zoomBy(wc, 1);
  } else if (ctrl && !input.alt && (key === '-' || key === '_')) {
    if (wc) zoomBy(wc, -1);
  } else if (ctrl && !input.alt && key === '0') {
    if (wc) setZoom(wc, 1);
  } else if ((ctrl && !input.alt && !input.shift && key === 'l') || (input.alt && !ctrl && !input.shift && key === 'd')) {
    focusAddressBar();
  } else if (ctrl && !input.alt && !input.shift && key === 't') {
    createTab(HOME);
  } else if (ctrl && !input.alt && !input.shift && (key === 'w' || key === 'f4')) {
    if (tab) { const id = tab.id; setImmediate(() => closeTab(id)); }
  } else if (ctrl && !input.alt && (key === 'tab' || key === 'pagedown' || key === 'pageup')) {
    const dir = (key === 'pageup' || (key === 'tab' && input.shift)) ? -1 : 1;
    const idx = tabs.findIndex((t) => t.id === activeId);
    if (idx !== -1 && tabs.length > 1) switchTab(tabs[(idx + dir + tabs.length) % tabs.length].id);
  } else if (ctrl && !input.alt && input.shift && key === 't') {
    reopenClosedTab();
  } else if (ctrl && !input.alt && !input.shift && key === 'f') {
    openFind();
  } else if (key === 'escape' && findOpen) {
    closeFind();
  } else if (ctrl && !input.alt && !input.shift && key === 'h') { // ATAJO_HISTORIAL
    openHistoryTab();
  } else if (ctrl && !input.alt && !input.shift && key === 'j') {
    openDownloadsTab();
  } else if (input.alt && !ctrl && !input.shift && key === 'arrowleft') {
    { const at = activeTab(); if (wc && at && at.cameFrom && at.view.webContents === wc && !wc.navigationHistory.canGoBack()) volverAlOrigen(at); else if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  } else if (input.alt && !ctrl && !input.shift && key === 'arrowright') {
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  } else {
    done = false;
  }
  if (done) event.preventDefault();
}


// ---------- Reabrir pestana cerrada, buscar en la pagina y zoom con la rueda ----------
const closedTabs = [];
function rememberClosed(tab, index) {
  try {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    const url = tab.pendingUrl || wc.getURL();
    if (!/^https?:/i.test(url || '')) return;
    closedTabs.push({ url: url, index: index });
    if (closedTabs.length > 25) closedTabs.shift();
  } catch (e) {}
}
function reopenClosedTab() {
  const c = closedTabs.pop();
  if (!c || !win || win.isDestroyed()) return;
  createTab(c.url);
  const t = tabs.pop();
  tabs.splice(Math.min(c.index, tabs.length), 0, t);
  sendTabs();
}

let findOpen = false;
const FIND_H = 36;
function openFind() {
  if (!win || win.isDestroyed() || !activeTab()) return;
  if (!findOpen) { findOpen = true; resizeView(); }
  win.webContents.focus();
  win.webContents.send('find-open');
}
function closeFind() {
  const was = findOpen;
  findOpen = false;
  tabs.forEach((t) => {
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.stopFindInPage('clearSelection'); } catch (e) {}
  });
  if (was) resizeView();
  if (win && !win.isDestroyed()) win.webContents.send('find-closed');
  const tab = activeTab();
  if (was && tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
}
ipcMain.on('find-text', (event, text, opts) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  const tab = activeTab();
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  const q = String(text || '').slice(0, 500);
  const o = opts || {};
  try {
    if (!q) {
      wc.stopFindInPage('clearSelection');
      win.webContents.send('find-result', { active: 0, matches: 0, final: true });
      return;
    }
    // En Electron, findNext:true significa "empezar una busqueda nueva"
    wc.findInPage(q, { forward: !o.backward, findNext: !o.next });
    win.webContents.focus();
  } catch (e) {}
});
ipcMain.on('find-close', (event) => {
  if (win && !win.isDestroyed() && event.sender === win.webContents) closeFind();
});

function attachExtras(wc, tab) {
  wc.on('dom-ready', () => { try { wc.insertCSS(SCROLL_CSS); } catch (e) {} });
  wc.on('zoom-changed', (_e, dir) => zoomBy(wc, dir === 'in' ? 1 : -1));
  wc.on('found-in-page', (_e, r) => {
    if (tab.id !== activeId || !win || win.isDestroyed()) return;
    win.webContents.send('find-result', { active: r.activeMatchOrdinal, matches: r.matches, final: !!r.finalUpdate });
  });
}


// ---------- Indicador de zoom (abajo a la derecha) ----------
const ZOOM_HTML = '<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:transparent;font:600 14px Segoe UI,system-ui,sans-serif"><div id="z" style="display:flex;align-items:center;justify-content:center;height:34px;border-radius:8px;background:#292a2d;color:#ffffff;box-shadow:0 2px 10px rgba(0,0,0,0.5)">100%</div>';
let zoomView = null;
let zoomReady = null;
let zoomTimer = null;
function ensureZoomView() {
  if (zoomView && !zoomView.webContents.isDestroyed()) return zoomView;
  zoomView = new WebContentsView({ webPreferences: { sandbox: true } });
  zoomView.setBackgroundColor('#00000000');
  zoomView.setVisible(false);
  win.contentView.addChildView(zoomView);
  const wcz = zoomView.webContents;
  zoomReady = new Promise((resolve) => wcz.once('did-finish-load', resolve));
  wcz.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ZOOM_HTML));
  return zoomView;
}
function showZoomIndicator(factor) {
  if (!win || win.isDestroyed()) return;
  try {
    const v = ensureZoomView();
    const pct = Math.round(factor * 100) + ' %';
    zoomReady.then(() => {
      if (!win || win.isDestroyed() || v.webContents.isDestroyed()) return;
      v.webContents.executeJavaScript('document.getElementById("z").textContent=' + JSON.stringify(pct)).catch(() => {});
      const [w, h] = win.getContentSize();
      v.setBounds({ x: w - 96 - 16, y: h - 34 - 16, width: 96, height: 34 });
      v.setVisible(true);
      win.contentView.addChildView(v);
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => { try { v.setVisible(false); } catch (e) {} }, 1500);
    });
  } catch (e) {}
}


// ---------- Barra de desplazamiento fina ----------
const SCROLL_CSS = '* { scrollbar-width: thin; scrollbar-color: rgba(140, 140, 140, 0.55) transparent; }';

// ---------- Proteccion contra la huella digital ----------
const cryptoFp = require('crypto');
const FP_SECRET = cryptoFp.randomBytes(16).toString('hex');
ipcMain.on('fp-get', (event) => {
  event.returnValue = { on: settings.fingerprint !== false, secret: FP_SECRET };
});
app.whenReady().then(() => {
  const ses = session.defaultSession;
  const fpFile = path.join(__dirname, 'fp-preload.js');
  const compatFile = path.join(__dirname, 'chrome-compat.js'); // CHROME_COMPAT
  try { if (typeof ses.registerPreloadScript === 'function') ses.registerPreloadScript({ type: 'frame', filePath: compatFile }); else ses.setPreloads(ses.getPreloads().concat([compatFile])); } catch (e) {}
  try {
    if (typeof ses.registerPreloadScript === 'function') {
      ses.registerPreloadScript({ type: 'frame', filePath: fpFile });
    } else {
      ses.setPreloads(ses.getPreloads().concat([fpFile]));
    }
  } catch (e) { console.log('No se pudo activar la proteccion de huella:', e.message); }
});


// ---------- Menu de ajustes moderno (panel flotante) ----------
// Para anadir algo: una linea en buildMenuData() y otra en MENU_ACTIONS.
// Tipos: item, checkbox (indent: true para sangrar), chips, label, separator
ipcMain.removeAllListeners('open-menu');
let menuView = null;
let menuReady = null;
let menuOpen = false;
let menuHooked = false;

function menuColors() {
  const t = OVERLAY_THEMES[settings.theme];
  if (!t) return { bg: '#292a2d', hover: '#3a3b3f', border: '#3c3d40', text: '#ffffff', muted: '#c4c7c5', accent: '#5b9bff' };
  return {
    bg: hslHex(t.h, t.s, t.l + 5),
    hover: hslHex(t.h, t.s, t.l + 16),
    border: hslHex(t.h, t.s, t.l + 15),
    text: '#f5f5f5',
    muted: hslHex(t.h, Math.min(t.s, 15), 76),
    accent: t.s === 0 ? '#9e9e9e' : hslHex(t.h, 70, 62)
  };
}

function buildMenuData() {
  if (tabMenuCtx) return buildTabMenuData();
  return buildMainMenuData();
}

function buildTabMenuData() {
  const t = tabMenuText();
  const tab = tabs.find((x) => x.id === tabMenuTarget);
  let muted = false;
  try { muted = !!(tab && !tab.view.webContents.isDestroyed() && tab.view.webContents.isAudioMuted()); } catch (e) {}
  const pinned = !!(tab && tab.pinned);
  return {
    theme: menuColors(),
    pos: { x: tabMenuCtx.x, y: tabMenuCtx.y },
    items: [
      { type: 'item', id: 'tabDuplicate', icon: 'duplicate', label: t.duplicate },
      { type: 'item', id: 'tabPin', icon: 'pin', label: pinned ? t.unpin : t.pin },
      { type: 'item', id: 'tabMute', icon: muted ? 'unmute' : 'mute', label: muted ? t.unmute : t.mute },
      { type: 'separator' },
      { type: 'item', id: 'tabCloseOthers', icon: 'closeOthers', label: t.closeOthers, disabled: !tabs.some((o) => o.id !== tabMenuTarget && !o.pinned) },
      { type: 'item', id: 'tabClose', icon: 'close', label: t.close }
    ]
  };
}

function buildMainMenuData() {
  if (menuExtMode) return buildExtMenuData();
  const es = settings.language === 'es';
  const L = es ? {
    history: 'Historial', downloads: 'Descargas', print: 'Imprimir',
    theme: 'Tema', privacy: 'Privacidad', fingerprint: 'Protecci\u00f3n contra la huella digital',
    showDl: 'Mostrar icono de descargas', language: 'Idioma'
  } : {
    history: 'History', downloads: 'Downloads', print: 'Print',
    theme: 'Theme', privacy: 'Privacy', fingerprint: 'Fingerprinting protection',
    showDl: 'Show downloads icon', language: 'Language'
  };
  const themeNames = es
    ? { actual: 'Fox', grafito: 'Helio', oceano: 'Oc\u00e9ano', bosque: 'Bosque', violeta: 'Violeta', ambar: '\u00c1mbar', rosa: 'Rosa' }
    : { actual: 'Fox', grafito: 'Helio', oceano: 'Ocean', bosque: 'Forest', violeta: 'Violet', ambar: 'Amber', rosa: 'Rose' };
  const themeColors = {
    actual: '#1e1f22', grafito: '#8a8a8a', oceano: '#3b7ddd', bosque: '#2fbf71',
    violeta: '#7e3fd6', ambar: '#e08a2c', rosa: '#d63a7a'
  };
  return {
    theme: menuColors(),
    items: [
// AJUSTES_PAGINA_MENU
      { type: 'item', id: 'history', icon: 'history', label: L.history },
      { type: 'item', id: 'downloads', icon: 'downloads', label: L.downloads },
      { type: 'item', id: 'print', icon: 'print', label: L.print, hint: 'Ctrl+P' },
      { type: 'item', id: 'extensions', icon: 'extPuzzle', label: es ? 'Extensiones' : 'Extensions' },
      { type: 'separator' },
      { type: 'item', id: 'settings', icon: 'settings', label: es ? 'Ajustes' : 'Settings' }
    ]
  };
}

// EXTENSIONES_MENU: pantalla "Extensiones" dentro del menu de las tres barras
let menuExtMode = false;
let menuExtSel = null;
let menuExtConfirm = false;
function extStoreDir() { return path.join(app.getPath('userData'), 'Extensions'); }
function extList() {
  try { return session.defaultSession.extensions.getAllExtensions(); } catch (e) { return []; }
}
function extIsRemovable(ext) {
  try { return !String(ext.path).toLowerCase().startsWith(path.join(__dirname, 'extensions').toLowerCase()); } catch (e) { return false; }
}
function extOptionsUrl(ext) {
  const mf = ext.manifest || {};
  const p = (mf.options_ui && mf.options_ui.page) || mf.options_page;
  return p ? 'chrome-extension://' + ext.id + '/' + String(p).replace(/^\/+/, '') : null;
}
async function extUninstall(ext) {
  const id = ext.id;
  try {
    const store = require('electron-chrome-web-store');
    if (typeof store.uninstallExtension === 'function') await store.uninstallExtension(id, { session: session.defaultSession });
  } catch (e) { console.log('Desinstalar (tienda):', e.message); }
  try {
    if (extList().some((x) => x.id === id)) await session.defaultSession.extensions.removeExtension(id);
  } catch (e) { console.log('Quitar extension:', e.message); }
  try {
    const dir = path.join(extStoreDir(), id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { console.log('Borrar carpeta de la extension:', e.message); }
}
function buildExtMenuData() {
  const es = settings.language === 'es';
  const t = es
    ? { title: 'Extensiones', back: 'Volver', store: 'Abrir la tienda de Chrome', none: 'No hay extensiones instaladas', opts: 'Opciones de la extensi\u00f3n', remove: 'Desinstalar', sure: '\u00bfSeguro? Pulsa otra vez', fixed: 'Incluida (no se puede quitar)' }
    : { title: 'Extensions', back: 'Back', store: 'Open the Chrome Web Store', none: 'No extensions installed', opts: 'Extension options', remove: 'Uninstall', sure: 'Sure? Click again', fixed: 'Built in (cannot be removed)' };
  const exts = extList();
  const sel = menuExtSel ? exts.find((e) => e.id === menuExtSel) : null;
  if (menuExtSel && !sel) menuExtSel = null;
  const items = [{ type: 'item', id: 'extBack', icon: 'extBack', label: t.back }];
  if (sel) {
    items.push({ type: 'label', label: sel.name });
    { const oculta = (Array.isArray(settings.hiddenExtensions) ? settings.hiddenExtensions : []).includes(sel.id); items.push({ type: 'item', id: 'extPin', icon: 'pin', label: es ? (oculta ? 'Fijar en la barra' : 'Quitar de la barra') : (oculta ? 'Pin to toolbar' : 'Unpin from toolbar') }); } // EXT_PIN
    items.push({ type: 'item', id: 'extOpts', icon: 'settings', label: t.opts, disabled: !extOptionsUrl(sel) });
    if (extIsRemovable(sel)) items.push({ type: 'item', id: 'extRemove', icon: 'close', label: menuExtConfirm ? t.sure : t.remove });
    else items.push({ type: 'label', label: t.fixed });
  } else {
    items.push({ type: 'label', label: t.title });
    if (!exts.length) items.push({ type: 'label', label: t.none });
    exts.forEach((e) => {
      const key = 'extSel:' + e.id;
      MENU_ACTIONS[key] = { run: () => { menuExtSel = e.id; menuExtConfirm = false; sendMenuData(); } };
      items.push({ type: 'item', id: key, icon: 'extPuzzle', label: e.name, hint: ((Array.isArray(settings.hiddenExtensions) ? settings.hiddenExtensions : []).includes(e.id)) ? '' : (es ? 'Fijada' : 'Pinned') }); // EXT_PIN
    });
    items.push({ type: 'separator' });
    items.push({ type: 'item', id: 'extStore', icon: 'extStore', label: t.store });
  }
  return { theme: menuColors(), items: items };
}

// close: true = el panel se cierra al elegirlo
const MENU_ACTIONS = {
  history: { close: true, run: () => openHistoryTab() },
  extensions: { run: () => { menuExtMode = true; menuExtSel = null; menuExtConfirm = false; sendMenuData(); } },
  extBack: { run: () => { if (menuExtSel) { menuExtSel = null; } else { menuExtMode = false; } menuExtConfirm = false; sendMenuData(); } },
  extPin: { run: () => { const id = menuExtSel; if (!id) return; const hl = Array.isArray(settings.hiddenExtensions) ? settings.hiddenExtensions.slice() : []; const ix = hl.indexOf(id); if (ix === -1) hl.push(id); else hl.splice(ix, 1); settings.hiddenExtensions = hl; applySettings(); } }, /* EXT_PIN */
  extStore: { close: true, run: () => { try { createTab('https://chromewebstore.google.com/'); } catch (e) {} } },
  extOpts: { close: true, run: () => { const ext = extList().find((e) => e.id === menuExtSel); const u = ext && extOptionsUrl(ext); if (u) { try { createTab(u); } catch (e) {} } } },
  extRemove: { run: async () => {
    const ext = extList().find((e) => e.id === menuExtSel);
    if (!ext || !extIsRemovable(ext)) return;
    if (!menuExtConfirm) { menuExtConfirm = true; sendMenuData(); return; }
    await extUninstall(ext);
    menuExtSel = null; menuExtConfirm = false; sendMenuData();
  } },
  downloads: { close: true, run: () => openDownloadsTab() },
  settings: { close: true, run: () => openSettingsTab() },
  print: { close: true, run: () => printActiveTab() },
  resetPerms: { close: true, run: () => resetPermissions() },
  tabDuplicate: { close: true, run: () => duplicateTab(tabMenuTarget) },
  tabPin: { close: true, run: () => pinTab(tabMenuTarget) },
  tabMute: { close: true, run: () => {
    const tab = tabs.find((t) => t.id === tabMenuTarget);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    tab.view.webContents.setAudioMuted(!tab.view.webContents.isAudioMuted());
    sendTabs();
  } },
  tabCloseOthers: { close: true, run: () => closeOtherTabs(tabMenuTarget) },
  tabClose: { close: true, run: () => closeTab(tabMenuTarget) },
  searchEngine: { run: (v) => { if (SEARCH_ENGINES[v]) { settings.searchEngine = v; applySettings(); sendMenuData(); } } },
  fingerprint: { run: (v) => { settings.fingerprint = (v === true); applySettings(); } },
  showDownloads: { run: (v) => { settings.showDownloads = (v === true); applySettings(); } },
  language: { run: (v) => { if (v === 'en' || v === 'es') setLanguage(v); } },
  theme: { run: (v) => {
    if (!THEME_IDS.includes(v) || v === settings.theme) return;
    settings.theme = v;
    applySettings();
    broadcastTheme();
    updateOverlay();
  } }
};

function sendMenuData() {
  if (!menuView || menuView.webContents.isDestroyed()) return;
  try { menuView.webContents.send('menu-data', buildMenuData()); } catch (e) {}
}

function ensureMenuView() {
  if (menuView && !menuView.webContents.isDestroyed()) return menuView;
  menuView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'menu-preload.js'), sandbox: true } });
  menuView.setBackgroundColor('#00000000');
  menuView.setVisible(false);
  win.contentView.addChildView(menuView);
  menuReady = new Promise((resolve) => menuView.webContents.once('did-finish-load', resolve));
  menuView.webContents.loadFile(path.join(__dirname, 'menu.html'));
  if (!menuHooked) {
    menuHooked = true;
    win.on('resize', () => { if (menuOpen) closeMenuPanel(); });
    win.on('blur', () => { if (menuOpen) closeMenuPanel(); });
  }
  return menuView;
}

function closeMenuPanel() {
  tabMenuCtx = null;
  if (!menuOpen) return;
  menuOpen = false;
  try { if (menuView && !menuView.webContents.isDestroyed()) menuView.setVisible(false); } catch (e) {}
  const tab = activeTab();
  try { if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus(); } catch (e) {}
}

async function openMenuPanel() {
  if (!win || win.isDestroyed()) return;
  if (menuOpen) { closeMenuPanel(); return; }
  try {
    const v = ensureMenuView();
    await menuReady;
    if (!win || win.isDestroyed() || v.webContents.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    v.setBounds({ x: 0, y: 0, width: w, height: h });
    sendMenuData();
    v.setVisible(true);
    win.contentView.addChildView(v);
    menuOpen = true;
    v.webContents.focus();
  } catch (e) { console.log('Menu:', e.message); }
}

ipcMain.on('open-ext-menu', () => { tabMenuCtx = null; menuExtMode = true; menuExtSel = null; menuExtConfirm = false; openMenuPanel(); }); // EXT_PIN
ipcMain.on('open-menu', () => { tabMenuCtx = null; menuExtMode = false; menuExtSel = null; menuExtConfirm = false; openMenuPanel(); });
ipcMain.on('menu-close', (event) => {
  if (menuView && event.sender === menuView.webContents) closeMenuPanel();
});
ipcMain.on('menu-click', (event, id, value) => {
  if (!menuView || event.sender !== menuView.webContents) return;
  const a = MENU_ACTIONS[String(id)];
  if (!a) return;
  if (a.close) closeMenuPanel();
  try { a.run(value); } catch (e) {}
  if (!a.close && menuOpen) sendMenuData();
});

// PESTANAS_MUERTAS: retira de la lista las pestanas cuyo contenido ya no existe
function tabAlive(t) {
  try { return !!(t && t.view && t.view.webContents && !t.view.webContents.isDestroyed()); } catch (e) { return false; }
}

function pruneDeadTabs() {
  const dead = tabs.filter((t) => !tabAlive(t));
  if (!dead.length) return false;
  dead.forEach((t) => {
    const i = tabs.indexOf(t);
    if (i !== -1) tabs.splice(i, 1);
    try { if (win && !win.isDestroyed() && t.view) win.contentView.removeChildView(t.view); } catch (e) {}
  });
  return true;
}

function repairActive() {
  if (!win || win.isDestroyed()) return;
  if (tabs.length === 0) { createTab(HOME); return; }
  if (!tabs.some((t) => t.id === activeId)) {
    activeId = tabs[tabs.length - 1].id;
    try { tabs.forEach((t) => t.view.setVisible(t.id === activeId)); } catch (e) {}
    try { resizeView(); } catch (e) {}
  }
}

const sendTabsSeguro = sendTabs;
sendTabs = function () {
  if (pruneDeadTabs()) repairActive();
  sendTabsSeguro();
};

setInterval(() => {
  try { if (pruneDeadTabs()) { repairActive(); sendTabs(); } } catch (e) {}
}, 1000);

// MENU_DIRECCION: menu del boton derecho (Cortar, Copiar, Pegar...) en la barra de direcciones
const menuDireccionHechas = new WeakSet();
function menuDireccionAdjuntar(w) {
  try {
    if (!w || menuDireccionHechas.has(w)) return;
    menuDireccionHechas.add(w);
    w.webContents.on('context-menu', (_event, params) => {
      try {
        if (w !== win || !params.isEditable) return;
        const es = settings.language === 'es';
        const f = params.editFlags || {};
        const wc = w.webContents;
        Menu.buildFromTemplate([
          { label: es ? 'Deshacer' : 'Undo', enabled: !!f.canUndo, click: () => wc.undo() },
          { label: es ? 'Rehacer' : 'Redo', enabled: !!f.canRedo, click: () => wc.redo() },
          { type: 'separator' },
          { label: es ? 'Cortar' : 'Cut', enabled: !!f.canCut, click: () => wc.cut() },
          { label: es ? 'Copiar' : 'Copy', enabled: !!f.canCopy, click: () => wc.copy() },
          { label: es ? 'Pegar' : 'Paste', enabled: !!f.canPaste, click: () => wc.paste() },
          { type: 'separator' },
          { label: es ? 'Seleccionar todo' : 'Select all', enabled: !!f.canSelectAll, click: () => wc.selectAll() }
        ]).popup({ window: w });
      } catch (e) {}
    });
  } catch (e) {}
}
app.on('browser-window-created', (_event, w) => menuDireccionAdjuntar(w));
try { BrowserWindow.getAllWindows().forEach(menuDireccionAdjuntar); } catch (e) {}

// ACTUALIZACIONES_AUTO: busca versiones nuevas en GitHub (solo en la app instalada)
if (app.isPackaged) {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => console.log('Actualizaciones:', e && e.message));
    autoUpdater.on('update-downloaded', (info) => {
      const { dialog } = require('electron');
      const opts = {
        type: 'info',
        buttons: ['Reiniciar ahora', 'Más tarde'],
        defaultId: 0,
        cancelId: 1,
        title: 'Actualización lista',
        message: 'Still Browser ' + info.version + ' está listo para instalarse.',
        detail: 'Se instalará al cerrar el navegador, o puedes reiniciar ahora.'
      };
      const r = (win && !win.isDestroyed()) ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
      r.then((x) => { if (x.response === 0) autoUpdater.quitAndInstall(); });
    });
    app.whenReady().then(() => {
      setTimeout(() => { autoUpdater.checkForUpdates().catch((e) => console.log('Actualizaciones:', e && e.message)); }, 8000);
    });
  } catch (e) { console.log('Actualizaciones:', e.message); }
}

// TEMA_PAGINAS: las paginas internas (ajustes, historial, descargas) siguen el tema elegido
const TEMA_PAGINAS = ['settings.html', 'history.html', 'downloads.html'];
const TEMA_VARS = ['--t-bg', '--t-surface', '--t-surface2', '--t-hover', '--t-line', '--t-accent'];
function esPaginaInterna(url) {
  const u = String(url || '').split('#')[0].split('?')[0];
  return u.startsWith('file:') && TEMA_PAGINAS.some((p) => u.endsWith('/' + p));
}
function temaPaginaJS() {
  const t = OVERLAY_THEMES[settings.theme];
  if (!t) return '(function(){var s=document.documentElement.style;' + JSON.stringify(TEMA_VARS) + '.forEach(function(n){s.removeProperty(n);});})()';
  const l = (d) => hslHex(t.h, t.s, Math.min(t.l + d, 90));
  const v = {
    '--t-bg': l(0), '--t-surface': l(5), '--t-surface2': l(12), '--t-hover': l(8), '--t-line': l(18),
    '--t-accent': t.s === 0 ? '#9e9e9e' : hslHex(t.h, 70, 62)
  };
  return '(function(){var s=document.documentElement.style;var v=' + JSON.stringify(v) + ';for(var k in v)s.setProperty(k,v[k]);})()';
}
function aplicarTemaPagina(wc) {
  try {
    if (wc && !wc.isDestroyed() && esPaginaInterna(wc.getURL())) wc.executeJavaScript(temaPaginaJS()).catch(() => {});
  } catch (e) {}
}
app.on('web-contents-created', (_e, wc) => {
  wc.on('dom-ready', () => aplicarTemaPagina(wc));
});
{
  const broadcastTemaOriginal = broadcastTheme;
  broadcastTheme = function () {
    broadcastTemaOriginal();
    const todas = (typeof allWindowTabs === 'function') ? allWindowTabs() : tabs;
    todas.forEach((t) => { try { aplicarTemaPagina(t.view.webContents); } catch (e) {} });
  };
}

// MISMA_PESTANA: Ajustes, Historial y Descargas reutilizan la pestana si esta vacia o en la pantalla de inicio
function openInternalTab(url) {
  const cur = activeTab();
  let reuse = false;
  try {
    if (cur && !cur.suspended && !cur.view.webContents.isDestroyed()) {
      const u = String(cur.view.webContents.getURL()).split('#')[0].split('?')[0];
      reuse = (u === '' || u === 'about:blank' || u === String(START_URL).split('#')[0]);
    }
  } catch (e) {}
  if (!reuse) { createTab(url); return; }
  const idx = tabs.indexOf(cur);
  createTab(url);
  const nt = tabs[tabs.length - 1];
  if (!nt || nt === cur) return;
  nt.cameFrom = HOME;
  tabs.splice(tabs.length - 1, 1);
  tabs.splice(idx, 0, nt);
  tabs.splice(tabs.indexOf(cur), 1);
  try { win.contentView.removeChildView(cur.view); } catch (e) {}
  try { cur.view.webContents.close(); } catch (e) {}
  switchTab(nt.id);
}

// VOLVER_ORIGEN: atras en una pagina interna que reemplazo la pantalla de inicio
function volverAlOrigen(tab) {
  const url = tab.cameFrom;
  tab.cameFrom = null;
  const idx = tabs.indexOf(tab);
  if (!url || idx === -1) return;
  createTab(url);
  const nt = tabs[tabs.length - 1];
  if (!nt || nt === tab) return;
  tabs.splice(tabs.length - 1, 1);
  tabs.splice(idx, 0, nt);
  tabs.splice(tabs.indexOf(tab), 1);
  try { win.contentView.removeChildView(tab.view); } catch (e) {}
  try { tab.view.webContents.close(); } catch (e) {}
  switchTab(nt.id);
}

// SEG_HTTP_OK: seguridad (HTTPS primero, GPC, WebRTC sin fugas, descargas peligrosas)
const SEG_HTTP_OK = new Set();
const SEG_UPGRADED = new Map();
function segPrivado(h) {
  return h === 'localhost' || h === '[::1]' || h.indexOf('.') === -1 ||
    /\.(local|lan|home|internal|localhost)$/.test(h) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}
function httpsUpgrade(details) {
  try {
    if (details.resourceType !== 'mainFrame' || !/^http:\/\//i.test(details.url)) return null;
    const u = new URL(details.url);
    if (u.port !== '' || segPrivado(u.hostname) || SEG_HTTP_OK.has(u.hostname)) return null;
    u.protocol = 'https:';
    const to = u.toString();
    SEG_UPGRADED.set(to, details.url);
    return to;
  } catch (e) { return null; }
}
function segEs() { try { return settings.language === 'es'; } catch (e) { return false; } }

app.on('web-contents-created', (_e, wc) => {
  try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch (e) {}
  wc.on('did-fail-load', (_ev, code, _desc, url, isMain) => {
    try {
      if (!isMain || ![-100, -101, -102, -107, -113, -118, -310].includes(code)) return;
      const orig = SEG_UPGRADED.get(url);
      if (!orig) return;
      SEG_UPGRADED.delete(url);
      const es = segEs();
      const host = new URL(orig).hostname;
      const { dialog, BrowserWindow } = require('electron');
      const opts = {
        type: 'warning',
        buttons: es ? ['Cancelar', 'Abrir sin cifrar'] : ['Cancel', 'Open unencrypted'],
        defaultId: 0, cancelId: 0,
        message: es ? host + ' no admite HTTPS.' : host + ' does not support HTTPS.',
        detail: es ? 'Si continuas, lo que envies y recibas no estara cifrado y otros podrian verlo.' : 'If you continue, what you send and receive will not be encrypted and others could see it.'
      };
      const par = BrowserWindow.getFocusedWindow();
      (par ? dialog.showMessageBox(par, opts) : dialog.showMessageBox(opts)).then((r) => {
        if (r.response === 1) { SEG_HTTP_OK.add(host); if (!wc.isDestroyed()) wc.loadURL(orig); }
      }).catch(() => {});
    } catch (e) {}
  });
});

const SEG_PELIGRO = /\.(exe|msi|bat|cmd|ps1|vbs|scr|com|hta|lnk|reg|jar|msix|appx)$/i;
app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const hd = details.requestHeaders;
    hd['Sec-GPC'] = '1';
    try { if (/^https:/i.test(details.url) && !hd['Sec-CH-UA'] && !hd['sec-ch-ua']) { const mv = ((/Chrome\/(\d+)/.exec(hd['User-Agent'] || hd['user-agent'] || '') || [])[1]) || '152'; hd['Sec-CH-UA'] = '"Chromium";v="' + mv + '", "Google Chrome";v="' + mv + '", "Not.A/Brand";v="99"'; hd['Sec-CH-UA-Mobile'] = '?0'; hd['Sec-CH-UA-Platform'] = '"Windows"'; } } catch (e) {} // CHROME_COMPAT
    segCookiesReq(details, hd); // SEG_COOKIES_HOOK
    callback({ requestHeaders: hd });
  });
  ses.on('will-download', (_e, item) => {
    try {
      const name = String(item.getFilename() || '');
      let finalUrl = '';
      try { const ch = item.getURLChain(); finalUrl = String(ch[ch.length - 1] || item.getURL()); } catch (e) {}
      let inseguro = false;
      try { const uu = new URL(finalUrl); inseguro = uu.protocol === 'http:' && !segPrivado(uu.hostname); } catch (e) {}
      const peligro = SEG_PELIGRO.test(name);
      if (!peligro && !inseguro) return; // SEG_DESC
      item.pause();
      const es = segEs();
      const { dialog, BrowserWindow } = require('electron');
      const opts = {
        type: 'warning',
        buttons: es ? ['Cancelar', 'Descargar'] : ['Cancel', 'Download'],
        defaultId: 0, cancelId: 0,
        message: peligro
          ? (es ? 'Este archivo puede ejecutar codigo: ' + name : 'This file can run code: ' + name)
          : (es ? 'Descarga sin cifrar: ' + name : 'Unencrypted download: ' + name),
        detail: (peligro ? '' : (es ? 'Viene de una conexion HTTP sin cifrar y alguien en el camino podria haberla modificado. ' : 'It comes from an unencrypted HTTP connection and could have been tampered with. ')) + (es ? 'Descargalo solo si confias en la web de la que viene.' : 'Only download it if you trust the site it comes from.')
      };
      const par = BrowserWindow.getFocusedWindow();
      (par ? dialog.showMessageBox(par, opts) : dialog.showMessageBox(opts)).then((r) => {
        try { if (r.response === 1) item.resume(); else item.cancel(); } catch (e) {}
      }).catch(() => { try { item.cancel(); } catch (e) {} });
    } catch (e) {}
  });
});

// SEG_PRIV: privacidad (DNS cifrado, User-Agent limpio, sin parametros de rastreo, borrado al cerrar opcional)
const SEG_TRACK = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|igshid|mc_eid|mc_cid|_hsenc|_hsmi|vero_id|li_fat_id|oly_enc_id|oly_anon_id|_openstat)$/i;
function segRedirect(details) {
  try {
    if (details.resourceType !== 'mainFrame') return null;
    const to = httpsUpgrade(details);
    if (details.method && details.method !== 'GET') return to;
    const u = new URL(to || details.url);
    let cambio = false;
    for (const k of Array.from(u.searchParams.keys())) {
      if (SEG_TRACK.test(k)) { u.searchParams.delete(k); cambio = true; }
    }
    if (!cambio) return to;
    const limpia = u.toString();
    if (to) { const o = SEG_UPGRADED.get(to); SEG_UPGRADED.delete(to); if (o) SEG_UPGRADED.set(limpia, o); }
    return limpia;
  } catch (e) { return null; }
}

// User-Agent sin "Electron" ni el nombre de la app
try {
  if (app.userAgentFallback) {
    app.userAgentFallback = app.userAgentFallback
      .replace(/\sElectron\/\S+/g, '')
      .replace(/(Gecko\))\s+\S+\/\S+\s+(Chrome\/)/, '$1 $2');
  }
} catch (e) {}

app.whenReady().then(() => {
  // DNS sobre HTTPS en modo automatico (si falla, vuelve al DNS normal)
  try {
    app.configureHostResolver({
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query']
    });
  } catch (e) {}
  // Sin descarga de diccionarios del corrector desde servidores de Google
  try { session.defaultSession.setSpellCheckerDictionaryDownloadURL('https://127.0.0.1:9/'); } catch (e) {}
});

// Borrar datos al cerrar: false = las sesiones se guardan (valor por defecto)
if (typeof settings.clearOnExit !== 'boolean') settings.clearOnExit = false;
let segLimpiado = false;
app.on('before-quit', (e) => {
  if (!settings.clearOnExit || segLimpiado) return;
  e.preventDefault();
  segLimpiado = true;
  const ses = session.defaultSession;
  const tareas = [ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]
    .map((p) => Promise.resolve(p).catch(() => {}));
  const tope = new Promise((r) => setTimeout(r, 4000));
  Promise.race([Promise.all(tareas), tope]).then(() => app.quit());
});
app.on('will-quit', () => {
  if (!settings.clearOnExit) return;
  try { historyList = []; fs.writeFileSync(historyFile, '[]'); } catch (e) {}
  try { fs.unlinkSync(sessionFile); } catch (e) {}
});

// AJUSTE_BORRADO: el estado de Ajustes incluye clearOnExit
const settingsPageStateOrig = settingsPageState;
settingsPageState = function () {
  const r = settingsPageStateOrig.apply(this, arguments);
  return r ? Object.assign({}, r, { clearOnExit: settings.clearOnExit === true }) : r;
};

// SEG_NAV: navegacion segura (esquemas peligrosos, redirecciones y webview)
const SEG_PROTO_OK = new Set(['http:', 'https:', 'about:', 'blob:', 'chrome-extension:', 'devtools:', 'view-source:']);
function segNavOk(wc, url) {
  try {
    const p = new URL(String(url)).protocol;
    if (SEG_PROTO_OK.has(p)) return true;
    if (p === 'file:') return String(wc.getURL()).startsWith('file:');
    return false;
  } catch (e) { return false; }
}
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
  const bloquear = (e, url) => {
    const u = (e && e.url) || url;
    if (!segNavOk(wc, u)) { e.preventDefault(); segExterno(wc, u); }
  };
  wc.on('will-navigate', bloquear);
  wc.on('will-redirect', bloquear);
  wc.on('will-frame-navigate', bloquear);
});

// SEG_EXTERNO: abrir aplicaciones externas (Zoom, Steam, Spotify...) solo con confirmacion
const SEG_APPS = {
  'zoommtg:': 'Zoom', 'zoomus:': 'Zoom', 'steam:': 'Steam', 'spotify:': 'Spotify',
  'discord:': 'Discord', 'slack:': 'Slack', 'msteams:': 'Microsoft Teams', 'tg:': 'Telegram',
  'skype:': 'Skype', 'whatsapp:': 'WhatsApp', 'vscode:': 'Visual Studio Code',
  'vscode-insiders:': 'VS Code Insiders', 'obsidian:': 'Obsidian', 'notion:': 'Notion',
  'battlenet:': 'Battle.net', 'com.epicgames.launcher:': 'Epic Games',
  'mailto:': 'tu programa de correo', 'tel:': 'tu aplicacion de telefono'
};
const SEG_EXT_RECUERDA = new Set();
const SEG_EXT_RECIENTE = new Map();
let segExtAbierto = false;
function segExterno(wc, url) {
  try {
    const s = String(url);
    if (s.length > 2000 || /[\s"<>^|\x00-\x1f]/.test(s)) return;
    const u = new URL(s);
    const app = SEG_APPS[u.protocol];
    if (!app) { console.log('SEG: navegacion bloqueada ->', s.slice(0, 80)); return; }
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch (e) {}
    const clave = host + '|' + u.protocol;
    const ahora = Date.now();
    if (ahora - (SEG_EXT_RECIENTE.get(s) || 0) < 3000) return;
    SEG_EXT_RECIENTE.set(s, ahora);
    if (SEG_EXT_RECIENTE.size > 50) SEG_EXT_RECIENTE.clear();
    const { dialog, shell, BrowserWindow } = require('electron');
    if (SEG_EXT_RECUERDA.has(clave)) { shell.openExternal(s).catch(() => {}); return; }
    if (segExtAbierto) return;
    segExtAbierto = true;
    const es = segEs();
    const quien = host || (es ? 'Una web' : 'A site');
    const opts = {
      type: 'question',
      buttons: es ? ['Cancelar', 'Abrir'] : ['Cancel', 'Open'],
      defaultId: 0, cancelId: 0,
      message: es ? quien + ' quiere abrir ' + app + '.' : quien + ' wants to open ' + app + '.',
      detail: es ? 'Continua solo si lo has pedido tu.' : 'Continue only if you asked for this.',
      checkboxLabel: es ? 'Permitir siempre en este sitio' : 'Always allow on this site',
      checkboxChecked: false
    };
    const par = BrowserWindow.getFocusedWindow();
    (par ? dialog.showMessageBox(par, opts) : dialog.showMessageBox(opts)).then((r) => {
      segExtAbierto = false;
      if (r.response !== 1) return;
      if (r.checkboxChecked && host) SEG_EXT_RECUERDA.add(clave);
      shell.openExternal(s).catch(() => {});
    }).catch(() => { segExtAbierto = false; });
  } catch (e) { segExtAbierto = false; }
}

// SEG_COOKIES: bloqueo de cookies (permitir / terceros / todas)
if (!['todas', 'terceros', 'permitir'].includes(settings.cookieMode)) settings.cookieMode = 'terceros';
function segSitio(h) {
  h = String(h || '').toLowerCase();
  if (/^[\d.]+$/.test(h) || h.indexOf(':') !== -1) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const sl = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  if (p[p.length - 1].length === 2 && sl.has(p[p.length - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
function segTercero(details) {
  try {
    const wc = details.webContents;
    if (!wc || wc.isDestroyed() || details.resourceType === 'mainFrame') return false;
    const top = new URL(wc.getURL()).hostname;
    if (!top) return false;
    return segSitio(top) !== segSitio(new URL(details.url).hostname);
  } catch (e) { return false; }
}
function segCookiesBloquear(details) {
  const modo = settings.cookieMode;
  if (modo === 'permitir') return false;
  try {
    if (/^(file|devtools|chrome-extension):/i.test(String(details.url))) return false;
    const wc = details.webContents;
    if (wc && !wc.isDestroyed() && String(wc.getURL()).startsWith('file:')) return false;
  } catch (e) {}
  if (modo === 'todas') return true;
  return segTercero(details);
}
function segCookiesReq(details, hd) {
  try {
    if (!segCookiesBloquear(details)) return;
    for (const k of Object.keys(hd)) { if (/^cookie$/i.test(k)) delete hd[k]; }
  } catch (e) {}
}
function segCookiesCambio(modo) {
  if (modo !== 'todas') return;
  try { session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {}); } catch (e) {}
}
app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      if (details.responseHeaders && segCookiesBloquear(details)) {
        const rh = details.responseHeaders;
        for (const k of Object.keys(rh)) { if (/^set-cookie$/i.test(k)) delete rh[k]; }
        return callback({ responseHeaders: rh });
      }
    } catch (e) {}
    callback({});
  });
  // Cookies creadas por JavaScript: en modo "todas" se borran al momento
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    try {
      if (removed || settings.cookieMode !== 'todas') return;
      const dom = String(cookie.domain || '').replace(/^\./, '');
      if (!dom) return;
      ses.cookies.remove((cookie.secure ? 'https://' : 'http://') + dom + (cookie.path || '/'), cookie.name).catch(() => {});
    } catch (e) {}
  });
});

// AJUSTE_COOKIES: el estado de Ajustes incluye cookieMode
const settingsPageStateOrig2 = settingsPageState;
settingsPageState = function () {
  const r = settingsPageStateOrig2.apply(this, arguments);
  return r ? Object.assign({}, r, { cookieMode: settings.cookieMode }) : r;
};

// ESTILO_GSI ESTILO_GSI_2: la tarjeta "Inicia sesion con Google" con la estetica de Ajustes
const GSI_FUENTE = "font-family:'Inter','Segoe UI',system-ui,sans-serif!important;";
const GSI_CSS = [
  "#credentials-picker-container{background:#1e1f22!important;border:1px solid #3a3b3f!important;border-radius:14px!important;box-shadow:0 10px 30px rgba(0,0,0,.5)!important;color:#e3e3e3!important;overflow:hidden;" + GSI_FUENTE + "}",
  "#picker-title,#picker-title *,#signing-in,#signing-in *{color:#e3e3e3!important;font-weight:600!important;" + GSI_FUENTE + "}",
  "#credentials-picker{background:transparent!important}",
  "#credentials-picker *{border-color:#3a3b3f!important}",
  "#credentials-picker [class*='-ssJRIf']{color:#e3e3e3!important;font-weight:600!important;" + GSI_FUENTE + "}",
  "#credentials-picker [class*='-K4efff']{color:#c4c7c5!important;" + GSI_FUENTE + "}"
].join('');
app.on('web-contents-created', (_e, wcx) => {
  wcx.on('did-frame-finish-load', (ev, isMain, pid, rid) => {
    if (isMain) return;
    try {
      const { webFrameMain } = require('electron');
      const fr = (ev && ev.frame) || webFrameMain.fromId(pid, rid);
      if (!fr || !/^https:\/\/accounts\.google\.com\/gsi\//.test(String(fr.url))) return;
      const aplicar = function (css) {
        try { const sh = new CSSStyleSheet(); sh.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; } catch (e) {}
        const barrido = function () {
          try {
            const raiz = document.getElementById('credentials-picker-container') || document.body;
            raiz.querySelectorAll('*').forEach(function (el) {
              if (el.tagName === 'IMG' || el instanceof SVGElement) return;
              const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(el).backgroundColor);
              if (!m) return;
              const a = (m[4] === undefined) ? 1 : parseFloat(m[4]);
              if (a > 0.3 && +m[1] > 200 && +m[2] > 200 && +m[3] > 200) el.style.setProperty('background-color', 'transparent', 'important');
            });
          } catch (e) {}
        };
        barrido();
        let t = null;
        const prog = function () { clearTimeout(t); t = setTimeout(barrido, 30); };
        try { new MutationObserver(prog).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
        document.addEventListener('mouseover', prog, true);
      };
      fr.executeJavaScript('(' + aplicar.toString() + ')(' + JSON.stringify(GSI_CSS) + ')').catch(() => {});
    } catch (e) {}
  });
});

// DL_POPUP: ventana emergente de descargas (como en Chromium)
(function () {
  try {
    const { shell } = require('electron');
    const DL_W = 356;
    let dlView = null, dlReady = null, dlOpen = false, dlAuto = false, dlTimer = null;
    let dlHeight = 140, dlIdleSince = 0, dlLastHide = 0, dlBound = false;
    const dlEs = () => !!(settings && settings.language === 'es');
    const dlActive = () => downloadsList.filter((d) => d.state === 'progressing' || d.state === 'paused');
    const dlAlive = () => !!(dlView && !dlView.webContents.isDestroyed());

    function dlPlace() {
      if (!dlAlive() || !win || win.isDestroyed()) return;
      const size = win.getContentSize();
      dlView.setBounds({ x: Math.max(0, size[0] - DL_W), y: 64, width: DL_W, height: dlHeight });
      try {
        if (typeof menuOpen !== 'undefined' && menuOpen) return;
        const ch = win.contentView.children;
        if (ch[ch.length - 1] !== dlView) win.contentView.addChildView(dlView);
      } catch (e) {}
    }

    function dlEnsure() {
      if (dlAlive()) return dlView;
      dlView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'dl-popup-preload.js'), sandbox: true } });
      dlView.setBackgroundColor('#00000000');
      dlView.setVisible(false);
      win.contentView.addChildView(dlView);
      dlView.webContents.on('blur', () => { if (dlOpen) dlHide(); });
      dlReady = new Promise((resolve) => dlView.webContents.once('did-finish-load', resolve));
      dlView.webContents.loadFile(path.join(__dirname, 'dl-popup.html'));
      return dlView;
    }

    function dlSend() {
      if (!dlAlive()) return;
      const items = downloadsList.filter((d) => d.state === 'progressing' || d.state === 'paused' || (Date.now() - (d.end || d.start || 0)) < 3600000).slice(0, 4).map((d) => ({ id: d.id, name: d.name, state: d.state, received: d.received, total: d.total })); /* DESCARGAS_RECIENTES */
      try { dlView.webContents.send('dl-data', { es: dlEs(), items: items, theme: menuColors() }); } catch (e) {}
    }

    function dlHide() {
      dlOpen = false;
      dlLastHide = Date.now();
      clearInterval(dlTimer);
      try { if (dlAlive()) dlView.setVisible(false); } catch (e) {}
    }

    function dlTick() {
      if (!dlOpen) return;
      if (!win || win.isDestroyed()) { dlHide(); return; }
      if (dlActive().length) dlIdleSince = Date.now();
      else if (dlAuto && Date.now() - dlIdleSince > 6000) { dlHide(); return; }
      dlSend();
      dlPlace();
    }

    async function dlShow(manual) {
      if (!win || win.isDestroyed()) return;
      const v = dlEnsure();
      await dlReady;
      if (!dlAlive()) return;
      if (!dlBound) { dlBound = true; win.on('resize', dlPlace); }
      dlOpen = true;
      dlAuto = !manual;
      dlIdleSince = Date.now();
      dlSend();
      dlPlace();
      v.setVisible(true);
      if (manual) {
        try { win.webContents.send('downloads-seen'); } catch (e) {}
        try { v.webContents.focus(); } catch (e) {}
      }
      clearInterval(dlTimer);
      dlTimer = setInterval(dlTick, 500);
    }

    const fromDl = (e) => dlAlive() && e.sender === dlView.webContents;
    const dlFind = (id) => downloadsList.find((x) => x.id === String(id));
    ipcMain.on('dl-popup-size', (e, h) => {
      if (!fromDl(e)) return;
      const n = Math.max(60, Math.min(600, Math.round(Number(h) || 0)));
      if (n !== dlHeight) { dlHeight = n; dlPlace(); }
    });
    ipcMain.on('dl-popup-close', (e) => { if (fromDl(e)) dlHide(); });
    ipcMain.on('dl-popup-all', (e) => { if (!fromDl(e)) return; dlHide(); try { openDownloadsTab(); } catch (er) {} });
    ipcMain.on('dl-popup-open', (e, id) => {
      if (!fromDl(e)) return;
      const d = dlFind(id);
      if (d && d.state === 'completed' && d.path) shell.openPath(d.path);
    });
    ipcMain.on('dl-popup-show', (e, id) => {
      if (!fromDl(e)) return;
      const d = dlFind(id);
      if (d && d.path) shell.showItemInFolder(d.path);
    });
    ipcMain.on('dl-popup-cancel', (e, id) => {
      if (!fromDl(e)) return;
      const it = downloadItems.get(String(id));
      try { if (it) it.cancel(); } catch (er) {}
    });

    // El icono de descargas abre/cierra la ventana emergente (la pagina completa: "Ver todas")
    ipcMain.removeAllListeners('open-downloads');
    ipcMain.on('open-downloads', () => {
      if (dlOpen) dlHide();
      else if (Date.now() - dlLastHide > 300) dlShow(true);
    });

    // Al empezar una descarga, se abre sola
    app.whenReady().then(() => {
      session.defaultSession.on('will-download', () => {
        setTimeout(() => { if (!dlOpen) dlShow(false); }, 200);
      });
    });
  } catch (e) { console.log('Popup de descargas:', e.message); }
})();

// ICONO_BARRA: identificador de la app e icono de las ventanas (barra de tareas de Windows)
(function () {
  try {
    app.setAppUserModelId('com.chorus.browser');
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(path.join(__dirname, 'icon-app.png'));
    if (!img.isEmpty()) app.on('browser-window-created', (_e, w) => { try { w.setIcon(img); } catch (e) {} });
  } catch (e) { console.log('Icono de la barra:', e.message); }
})();
