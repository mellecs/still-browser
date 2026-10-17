// Proteccion basica contra la huella digital (Still Browser)
const { ipcRenderer, webFrame } = require('electron');

function inject(seed) {
  'use strict';
  const rnd = (n) => {
    let t = (seed + Math.imul(n, 0x6D2B79F5)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const noisePixels = (d) => {
    for (let i = 0; i + 3 < d.length; i += 4) {
      if (rnd(i) < 0.08) d[i + ((rnd(i + 1) * 3) | 0)] ^= 1;
    }
  };

  // Canvas
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C2D && window.HTMLCanvasElement) {
    const origGetImageData = C2D.getImageData;
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const noisyCopy = (c) => {
      try {
        const w = c.width, h = c.height;
        if (!w || !h || w * h > 4000000) return c;
        const t = document.createElement('canvas');
        t.width = w; t.height = h;
        const x = t.getContext('2d');
        x.drawImage(c, 0, 0);
        const img = origGetImageData.call(x, 0, 0, w, h);
        noisePixels(img.data);
        x.putImageData(img, 0, 0);
        return t;
      } catch (e) { return c; }
    };
    C2D.getImageData = function () {
      const img = origGetImageData.apply(this, arguments);
      try { if (img.data.length <= 16000000) noisePixels(img.data); } catch (e) {}
      return img;
    };
    HTMLCanvasElement.prototype.toDataURL = function () { return origToDataURL.apply(noisyCopy(this), arguments); };
    HTMLCanvasElement.prototype.toBlob = function () { return origToBlob.apply(noisyCopy(this), arguments); };
  }

  // WebGL: oculta el modelo real de la tarjeta grafica
  const patchGL = (proto) => {
    if (!proto) return;
    const og = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === 37445) return 'Google Inc. (Intel)'; // FP_WEBGL_REALISTA
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return og.apply(this, arguments);
    };
  };
  patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  // Audio
  if (window.AnalyserNode) {
    ['getFloatFrequencyData', 'getFloatTimeDomainData'].forEach((name) => {
      const o = AnalyserNode.prototype[name];
      if (!o) return;
      AnalyserNode.prototype[name] = function (arr) {
        o.apply(this, arguments);
        try { for (let i = 0; i < arr.length; i += 7) arr[i] += (rnd(i) - 0.5) * 1e-4; } catch (e) {}
      };
    });
  }
  if (window.AudioBuffer) {
    const og = AudioBuffer.prototype.getChannelData;
    const seen = new WeakMap();
    AudioBuffer.prototype.getChannelData = function (ch) {
      const d = og.apply(this, arguments);
      try {
        let s = seen.get(this);
        if (!s) { s = {}; seen.set(this, s); }
        if (!s[ch]) {
          s[ch] = true;
          for (let i = 0; i < d.length; i += 50) d[i] += (rnd(i) - 0.5) * 1e-7;
        }
      } catch (e) {}
      return d;
    };
  }

  // Nucleos y memoria unificados
  const def = (name, value) => {
    try {
      if (!(name in Navigator.prototype)) return;
      Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true, enumerable: true });
    } catch (e) {}
  };
  def('hardwareConcurrency', 4);
  def('deviceMemory', 8);
}

(function () {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    if (/(^|\.)accounts\.(google\.[a-z.]+|youtube\.com)$/i.test(location.hostname)) return; // FP_SIN_GOOGLE_LOGIN
    const cfg = ipcRenderer.sendSync('fp-get');
    if (!cfg || !cfg.on) return;
    let top = location.origin;
    try {
      if (location.ancestorOrigins && location.ancestorOrigins.length) {
        top = location.ancestorOrigins[location.ancestorOrigins.length - 1];
      }
    } catch (e) {}
    const str = String(cfg.secret) + '|' + top;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    const seed = h >>> 0;
    webFrame.executeJavaScript('(' + inject.toString() + ')(' + seed + ')');
  } catch (e) {}
})();