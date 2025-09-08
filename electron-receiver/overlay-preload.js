const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OverlayApi', {
  goFullscreen: () => { try { ipcRenderer.send('overlay:go-fullscreen'); } catch(_) {} },
  exitFullscreen: () => { try { ipcRenderer.send('overlay:exit-fullscreen'); } catch(_) {} },
  setPassThrough: (on = true) => { try { ipcRenderer.send('overlay:pass-through', !!on); } catch(_) {} },
  onOverlayStart: (cb) => {
    try { ipcRenderer.on('overlay:start', (_e, type) => { if (type === 'start') try { cb && cb(); } catch(_) {} }); } catch(_) {}
  },
  onPreCount: (cb) => {
    try { ipcRenderer.on('overlay:precount', () => { try { cb && cb(); } catch(_) {} }); } catch(_) {}
  }
});
