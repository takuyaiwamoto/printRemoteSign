const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { execFile } = require('child_process');
const os = require('os');
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

  // Create overlay window (semi-transparent performer layer)
  createOverlayWindow();
}

let overlayWin = null;
function createOverlayWindow() {
  try {
    const primary = screen.getPrimaryDisplay();
    const ov = new BrowserWindow({
      width: Math.max(600, Math.floor(primary.workArea.width * 0.6)),
      height: Math.max(400, Math.floor(primary.workArea.height * 0.6)),
      x: primary.workArea.x + 40,
      y: primary.workArea.y + 40,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'overlay-preload.js'),
      },
    });
    ov.setMenuBarVisibility(false);
    // Pass server/channel to overlay so it can subscribe directly
    const qs = new URLSearchParams();
    try {
      let fileCfg = {}; const p = path.join(__dirname, 'config.json');
      if (fs.existsSync(p)) fileCfg = JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
      const server = process.env.SERVER_URL || fileCfg.server || 'ws://localhost:8787';
      const channel = process.env.CHANNEL || fileCfg.channel || 'default';
      qs.set('server', server); qs.set('channel', channel);
    } catch(_) {}
    ov.loadFile('overlay.html', { query: Object.fromEntries(qs) });
    overlayWin = ov;

    // IPC: overlay commands
    ipcMain.on('overlay:go-fullscreen', () => {
      try {
        // Fit to the current display's work area (maximize without true fullscreen)
        const current = ov.getBounds();
        const disp = screen.getDisplayMatching(current) || screen.getPrimaryDisplay();
        const wa = disp.workArea;
        ov.setFullScreen(false);
        ov.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
      } catch(_) {}
    });
    ipcMain.on('overlay:exit-fullscreen', () => {
      try { ov.setFullScreen(false); } catch(_) {}
    });
    ipcMain.on('overlay:pass-through', (_ev, on) => {
      try { ov.setIgnoreMouseEvents(!!on, { forward: true }); } catch(_) {}
    });

    // Forward triggers from receiver renderer to overlay window
    ipcMain.on('overlay:trigger', (_ev, type) => {
      try { overlayWin?.webContents?.send('overlay:start', type); } catch(_) {}
    });
    ipcMain.on('overlay:precount', () => {
      try { overlayWin?.webContents?.send('overlay:precount'); } catch(_) {}
    });
  } catch (e) {
    console.error('[overlay] create error', e);
  }
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
    const targetName = 'Brother_MFC_J6983CDW_2';
    console.log('[print] received job payload bytes=', (payload?.dataURL||'').length);
    // Try CUPS `lp` path first to force plain paper (MediaType=stationery). Fallback to webContents.print.
    const tryLpFirst = process.platform === 'darwin' || process.platform === 'linux';

    async function printViaLp(dataUrl){
      return new Promise((resolve, reject) => {
        try {
          const m = String(dataUrl||'').match(/^data:image\/\w+;base64,(.*)$/);
          if (!m) return reject(new Error('invalid_dataurl'));
          const buf = Buffer.from(m[1], 'base64');
          const tmp = path.join(os.tmpdir(), `print_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
          fs.writeFileSync(tmp, buf);
          const args = [
            '-d', targetName,
            // Force plain paper and tray-1. Quality normal.
            '-o', 'MediaType=stationery',
            '-o', 'InputSlot=tray-1',
            '-o', 'print-quality=Normal',
            // Force page size to L (3.5x5 inch) to match tray setting
            '-o', 'PageSize=3.5x5',
            tmp
          ];
          console.log('[print][lp] exec lp', args.join(' '));
          execFile('lp', args, (err, stdout, stderr) => {
            try { fs.unlink(tmp, ()=>{}); } catch(_) {}
            if (err) { console.error('[print][lp] error', err?.message||err, stderr||''); reject(err); }
            else { console.log('[print][lp] submitted', stdout?.trim()||''); resolve(true); }
          });
        } catch(e){ reject(e); }
      });
    }
    // Hidden window to render the image for printing (fallback route)
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    const html = `<!doctype html><html><head><meta charset='utf-8'><style>
      html,body{margin:0;padding:0}
      @page { size: 100mm 148mm; margin: 0; }
      .wrap{width:100mm;height:148mm;display:flex;align-items:center;justify-content:center}
      img{max-width:100%;max-height:100%;}
    </style></head><body><div class='wrap'><img id='p' src='${payload?.dataURL || ''}'/></div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give the image a moment to load in renderer OR try CUPS first
    setTimeout(async () => {
      try {
        if (tryLpFirst) {
          try {
            await printViaLp(payload?.dataURL||'');
            try { win.close(); } catch(_) {}
            return;
          } catch (e) {
            console.warn('[print] lp route failed, falling back to webContents.print', e?.message||e);
          }
        }
        const printers = await win.webContents.getPrintersAsync();
        console.log('[print] available printers:', printers.map(p=>p.name));
        const found = printers.find(p => (p.name === targetName) || (p.displayName === targetName));
        const alt = printers.find(p => p.name?.includes('Brother') || p.displayName?.includes('Brother'));
        const deviceName = found?.name || alt?.name;
        if (!deviceName) console.warn('[print] target printer not found; using system default');
        else console.log('[print] using printer:', deviceName);
        // Fallback renderer print: also set L size (3.5x5 inch)
        win.webContents.print({
          silent: true,
          deviceName,
          printBackground: true,
          margins: { marginType: 'none' },
          // L size = 3.5 x 5.0 inch ≒ 88.9 x 127.0 mm
          pageSize: { width: 88900, height: 127000 },
          landscape: false,
        }, (success, errorType) => {
          try { win.close(); } catch(_) {}
          if (!success) console.error('print failed', errorType);
          else console.log('[print] job submitted');
        });
      } catch (e) {
        try { win.close(); } catch(_) {}
        console.error('print error', e);
      }
    }, 300);
  } catch (e) {
    console.error('print-ink error', e);
  }
});
