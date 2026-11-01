// YT_INSTANTE: salta el anuncio llevandolo al final; solo si es anuncio y ya esta cargado
(() => {
  if (window.__chorusYT) return;
  window.__chorusYT = true;

  const css = document.createElement('style');
  css.textContent = [
    '#masthead-ad', '#player-ads', '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-banner-promo-renderer',
    'ytd-companion-slot-renderer'
  ].join(',') + '{display:none !important;}';
  (document.head || document.documentElement).appendChild(css);

  const SALTAR = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button';
  let enAnuncio = false, mudoAntes = false, inicioAd = 0; /* YT_SEGURO */

  const quitar = () => {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!player || !video) return;
    if (player.classList.contains('ad-showing')) {
      if (!enAnuncio) { enAnuncio = true; mudoAntes = video.muted; inicioAd = Date.now(); }
      const saltar = document.querySelector(SALTAR);
      if (saltar) saltar.click();
      const cerrar = document.querySelector('.ytp-ad-overlay-close-button');
      if (cerrar) cerrar.click();
      if (!video.muted) video.muted = true;
      const d = video.duration;
      if (Date.now() - inicioAd > 400 && !/^\/shorts\//.test(location.pathname) && video.readyState >= 1 && isFinite(d) && d > 0 && d < 180 && video.currentTime < d - 0.3) {
        try { video.playbackRate = 16; } catch (e) {} /* YT_ACELERA */
      }
    } else if (enAnuncio) {
      enAnuncio = false;
      video.muted = mudoAntes; try { video.playbackRate = 1; } catch (e) {}
      if (video.paused && !video.ended) video.play().catch(() => {});
    }
  };

  // QUITAR_AVISO: quita el aviso de "bloqueadores no permitidos" y reanuda el video
  const quitarAviso = () => {
    const aviso = document.querySelector('ytd-enforcement-message-view-model');
    if (!aviso) return;
    const dialogo = aviso.closest('tp-yt-paper-dialog') || aviso;
    dialogo.remove();
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (v && v.paused) v.play().catch(() => {});
  };
  setInterval(() => { quitar(); quitarAviso(); }, 100);
})();