const { app, BrowserWindow } = require('electron');

function createWindow() {
  const server = process.env.SERVER_URL || 'ws://localhost:8787';
  const channel = process.env.CHANNEL || 'default';

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
    query: { server, channel }
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

