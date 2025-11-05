const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OverlayApi', {
  goFullscreen: () => { try { ipcRenderer.send('overlay:go-fullscreen'); } catch(_) {} },
  exitFullscreen: () => { try { ipcRenderer.send('overlay:exit-fullscreen'); } catch(_) {} },
  setPassThrough: (on = true) => { try { ipcRenderer.send('overlay:pass-through', !!on); } catch(_) {} },
  selectCaptureArea: () => {
    try { return ipcRenderer.invoke('overlay:select-capture'); }
    catch (_) { return Promise.resolve(null); }
  },
  onOverlayStart: (cb) => {
    try { ipcRenderer.on('overlay:start', (_e, type) => { if (type === 'start') try { cb && cb(); } catch(_) {} }); } catch(_) {}
  },
  onPreCount: (cb) => {
    try { ipcRenderer.on('overlay:precount', () => { try { cb && cb(); } catch(_) {} }); } catch(_) {}
  },
  onOverlayStop: (cb) => {
    try { ipcRenderer.on('overlay:stop', () => { try { cb && cb(); } catch(_) {} }); } catch(_) {}
  }
});
