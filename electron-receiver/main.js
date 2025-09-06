const { app, BrowserWindow } = require('electron');
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
