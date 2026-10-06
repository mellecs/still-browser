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

  let enAnuncio = false, mudoAntes = false, velAntes = 1;
  const quitar = () => {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!player || !video) return;
    if (player.classList.contains('ad-showing')) {
      if (!enAnuncio) { enAnuncio = true; mudoAntes = video.muted; velAntes = video.playbackRate || 1; }
      const saltar = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (saltar) saltar.click();
      video.muted = true;
      video.playbackRate = 16;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
    } else if (enAnuncio) {
      enAnuncio = false;
      video.muted = mudoAntes;
      video.playbackRate = velAntes;
    }
  };
  setInterval(quitar, 250);
})();
