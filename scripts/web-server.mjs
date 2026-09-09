import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8080);

const files = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/firebase.js', 'firebase.js'],
  ['/styles.css', 'styles.css'],
  ['/manifest.json', 'manifest.json'],
  ['/service-worker.js', 'service-worker.js']
]);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
    const relative = files.get(pathname);
    if (!relative) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const filePath = path.join(root, relative);
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Agenda Web: http://localhost:${port}`);
  console.log('Ctrl+C para detener.');
});
