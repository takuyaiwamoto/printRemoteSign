const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OverlayApi', {
  goFullscreen: () => { try { ipcRenderer.send('overlay:go-fullscreen'); } catch(_) {} },
  exitFullscreen: () => { try { ipcRenderer.send('overlay:exit-fullscreen'); } catch(_) {} },
});

