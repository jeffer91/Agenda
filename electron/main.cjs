const { app, BrowserWindow, shell, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = 4173;
const ROOT = path.resolve(__dirname, '..');

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/firebase.js', 'firebase.js'],
  ['/styles.css', 'styles.css'],
  ['/manifest.json', 'manifest.json'],
  ['/service-worker.js', 'service-worker.js']
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function createServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
      const relative = PUBLIC_FILES.get(pathname);

      if (!relative) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const filePath = path.join(ROOT, relative);
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Error loading Agenda');
          return;
        }

        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    });

    server.once('error', reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

function isGoogleAuthUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'accounts.google.com' || hostname.endsWith('.google.com');
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#f3f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
          }
        }
      };
    }

    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.loadURL(`http://localhost:${PORT}`);
}

let server;

app.whenReady().then(async () => {
  try {
    server = await createServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      'Agenda no pudo iniciar',
      `No se pudo abrir el servidor local en el puerto ${PORT}.\n\n${error.message}`
    );
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  server?.close();
});
