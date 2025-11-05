const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SelectionApi', {
  onInit: (cb) => {
    try {
      ipcRenderer.once('selection:init', (_event, data) => {
        try { cb && cb(data); } catch (_) {}
      });
    } catch (_) {}
  },
  notify: (channel, payload) => {
    try { ipcRenderer.send(channel, payload); } catch (_) {}
  }
});
