const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function createWindow() {
  // 設定の優先順位: 環境変数 > config.json > デフォルト
  let fileCfg = {};
  try {
    const p = path.join(__dirname, 'config.json');
    if (fs.existsSync(p)) fileCfg = JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch (_) {}

  const server = process.env.SERVER_URL || fileCfg.server || 'ws://localhost:8787';
  const channel = process.env.CHANNEL || fileCfg.channel || 'default';
  const bufferMs = Number(process.env.BUFFER_MS || fileCfg.bufferMs || 300);

  const win = new BrowserWindow({
    width: 900,
    height: 1272, // ~ A4 ratio height for width 900
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#111111'
  });

  win.setMenuBarVisibility(false);
  win.loadFile('receiver.html', {
    query: { server, channel, buffer: String(bufferMs) }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Printing pipeline: receive PNG dataURL and print silently to the target device
ipcMain.on('print-ink', async (ev, payload) => {
  try {
    const deviceName = 'Brother_MFC_J6983CDW';
    // Hidden window to render the image for printing
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    const html = `<!doctype html><html><head><meta charset='utf-8'><style>
      html,body{margin:0;padding:0}
      @page { size: 100mm 148mm; margin: 0; }
      .wrap{width:100mm;height:148mm;display:flex;align-items:center;justify-content:center}
      img{max-width:100%;max-height:100%;}
    </style></head><body><div class='wrap'><img id='p' src='${payload?.dataURL || ''}'/></div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give the image a moment to load in renderer
    setTimeout(() => {
      win.webContents.print({
        silent: true,
        deviceName,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: 100000, height: 148000 }, // Postcard 100x148mm in microns
        landscape: false,
      }, (success, errorType) => {
        try { win.close(); } catch(_) {}
        if (!success) console.error('print failed', errorType);
      });
    }, 300);
  } catch (e) {
    console.error('print-ink error', e);
  }
});
