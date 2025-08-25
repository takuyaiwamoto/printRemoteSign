const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');

let mainWindow;
let isFullScreen = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        },
        title: 'Presentation Viewer'
    });

    mainWindow.loadFile(path.join(__dirname, 'viewer.html'));

    const menu = Menu.buildFromTemplate([
        {
            label: 'ファイル',
            submenu: [
                {
                    label: 'サーバーに接続',
                    click: () => {
                        mainWindow.webContents.send('connect-server');
                    }
                },
                {
                    label: '終了',
                    role: 'quit'
                }
            ]
        },
        {
            label: '表示',
            submenu: [
                {
                    label: 'フルスクリーン切替',
                    accelerator: 'F11',
                    click: () => {
                        isFullScreen = !isFullScreen;
                        mainWindow.setFullScreen(isFullScreen);
                    }
                },
                {
                    label: 'デベロッパーツール',
                    accelerator: 'F12',
                    click: () => {
                        mainWindow.webContents.openDevTools();
                    }
                }
            ]
        }
    ]);

    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});