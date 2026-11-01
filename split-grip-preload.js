const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  let drag = false;
  document.addEventListener('pointerdown', (e) => {
    drag = true;
    try { document.body.classList.add('d'); } catch (er) {}
    try { document.body.setPointerCapture(e.pointerId); } catch (er) {}
    ipcRenderer.send('grip-drag', 'down', e.screenX, e.screenY);
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => { if (drag) ipcRenderer.send('grip-drag', 'move', e.screenX, e.screenY); });
  document.addEventListener('pointerup', (e) => { if (!drag) return; drag = false; try { document.body.classList.remove('d'); } catch (er) {} ipcRenderer.send('grip-drag', 'up', e.screenX, e.screenY); });
  document.addEventListener('pointercancel', (e) => { if (!drag) return; drag = false; try { document.body.classList.remove('d'); } catch (er) {} ipcRenderer.send('grip-drag', 'cancel', e.screenX, e.screenY); });
});