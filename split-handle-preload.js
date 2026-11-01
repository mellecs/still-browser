const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  let drag = false;
  ipcRenderer.on('split-handle-cursor', (_e, c) => { try { document.body.style.cursor = c; } catch (er) {} });
  ipcRenderer.send('split-handle-ready');
  document.addEventListener('pointerdown', (e) => {
    drag = true;
    try { document.body.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => { if (drag) ipcRenderer.send('split-drag', e.screenX, e.screenY); });
  const fin = () => { drag = false; };
  document.addEventListener('pointerup', fin);
  document.addEventListener('pointercancel', fin);
  document.addEventListener('dblclick', () => ipcRenderer.send('split-drag', -1));
});