import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

const assets = [
  'app.js',
  'firebase.js',
  'styles.css',
  'manifest.json',
  'icon.svg',
  'native-auth.js'
];

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\s*<script\s+src=["']https:\/\/accounts\.google\.com\/gsi\/client["'][^>]*><\/script>\s*/i, '\n');
html = html.replace('</head>', '  <script src="./native-auth.js"></script>\n</head>');
await fs.writeFile(path.join(out, 'index.html'), html, 'utf8');

for (const asset of assets) {
  await fs.copyFile(path.join(root, asset), path.join(out, asset));
}

let serviceWorker = await fs.readFile(path.join(root, 'service-worker.js'), 'utf8');
serviceWorker = serviceWorker
  .replace("const CACHE='agenda-v4';", "const CACHE='agenda-android-v3';")
  .replace("'./icon.svg']", "'./icon.svg','./native-auth.js']");
await fs.writeFile(path.join(out, 'service-worker.js'), serviceWorker, 'utf8');

console.log('Bundle Android preparado en www/.');
