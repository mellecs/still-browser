// CHROME_COMPAT: la pagina ve los mismos datos de navegador que en un Chrome normal
const { webFrame } = require('electron');

function inject() {
  'use strict';
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
  if (!m) return;
  const v = m[1];
  try {
    const actual = navigator.userAgentData;
    const tieneChrome = actual && (actual.brands || []).some((b) => b.brand === 'Google Chrome');
    if (!tieneChrome) {
      const brands = [
        { brand: 'Chromium', version: v },
        { brand: 'Google Chrome', version: v },
        { brand: 'Not.A/Brand', version: '99' }
      ];
      const full = [
        { brand: 'Chromium', version: v + '.0.0.0' },
        { brand: 'Google Chrome', version: v + '.0.0.0' },
        { brand: 'Not.A/Brand', version: '99.0.0.0' }
      ];
      const uad = {
        brands: brands,
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: function () {
          return Promise.resolve({
            brands: brands, mobile: false, platform: 'Windows', platformVersion: '10.0.0',
            architecture: 'x86', bitness: '64', model: '', wow64: false,
            uaFullVersion: v + '.0.0.0', fullVersionList: full
          });
        },
        toJSON: function () { return { brands: brands, mobile: false, platform: 'Windows' }; }
      };
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: function () { return uad; }, configurable: true, enumerable: true });
    }
  } catch (e) {}
  try {
    const c = window.chrome || (window.chrome = {});
    if (!c.app) c.app = { isInstalled: false, getDetails: function () { return null; }, getIsInstalled: function () { return false; }, installState: function (cb) { if (cb) cb('not_installed'); }, runningState: function () { return 'cannot_run'; } };
    if (!c.csi) c.csi = function () { return { onloadT: Date.now(), startE: Date.now(), pageT: performance.now(), tran: 15 }; };
    if (!c.loadTimes) c.loadTimes = function () {
      const t = performance.timing;
      return { requestTime: t.navigationStart / 1000, startLoadTime: t.navigationStart / 1000, commitLoadTime: t.responseStart / 1000, finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000, finishLoadTime: t.loadEventEnd / 1000, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
    };
  } catch (e) {}
}

(function () {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    webFrame.executeJavaScript('(' + inject.toString() + ')()');
  } catch (e) {}
})();

// PASSKEY_GOOGLE: sin ventana de llave de seguridad en el inicio de sesion de Google
function bloqueaPasskey() {
  try {
    const cr = navigator.credentials;
    if (!cr || !cr.get) return;
    const orig = cr.get.bind(cr);
    cr.get = function (opts) {
      if (opts && opts.publicKey) return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
      return orig(opts);
    };
  } catch (e) {}
}
(function () {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    if (/(^|\.)accounts\.(google\.[a-z.]+|youtube\.com)$/i.test(location.hostname)) webFrame.executeJavaScript('(' + bloqueaPasskey.toString() + ')()');
  } catch (e) {}
})();

// FEDCM_OFF: Still no ofrece FedCM, asi las webs usan la ventana emergente de Google
function ocultaFedCM() {
  try { delete window.IdentityCredential; } catch (e) {}
  try { delete window.IdentityProvider; } catch (e) {}
  try {
    const cr = navigator.credentials;
    if (cr && cr.get) {
      const orig = cr.get.bind(cr);
      cr.get = function (opts) {
        if (opts && opts.identity) return Promise.reject(new DOMException('FedCM is not supported.', 'NotSupportedError'));
        return orig(opts);
      };
    }
  } catch (e) {}
}
(function () {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    webFrame.executeJavaScript('(' + ocultaFedCM.toString() + ')()');
  } catch (e) {}
})();