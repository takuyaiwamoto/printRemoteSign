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
