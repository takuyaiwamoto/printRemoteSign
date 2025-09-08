const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PrintBridge', {
  printInk: (payload) => {
    try { ipcRenderer.send('print-ink', payload || {}); } catch(_) {}
  }
});

