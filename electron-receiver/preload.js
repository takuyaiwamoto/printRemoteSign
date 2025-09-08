const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PrintBridge', {
  printInk: (payload) => {
    try { ipcRenderer.send('print-ink', payload || {}); } catch(_) {}
  }
});

// Overlay control bridge (to notify overlay window from receiver renderer)
contextBridge.exposeInMainWorld('OverlayBridge', {
  triggerStart: () => { try { ipcRenderer.send('overlay:trigger', 'start'); } catch(_) {} }
});

// Pre-count notification from receiver to overlay (start 3-2-1)
contextBridge.exposeInMainWorld('OverlayPreCount', {
  notify: () => { try { ipcRenderer.send('overlay:precount'); } catch(_) {} }
});
