const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OverlayApi', {
  goFullscreen: () => { try { ipcRenderer.send('overlay:go-fullscreen'); } catch(_) {} },
  exitFullscreen: () => { try { ipcRenderer.send('overlay:exit-fullscreen'); } catch(_) {} },
  setPassThrough: (on = true) => { try { ipcRenderer.send('overlay:pass-through', !!on); } catch(_) {} },
});
