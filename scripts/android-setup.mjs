import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join(root, 'scripts', 'prepare-web.mjs')]);

if (!fs.existsSync(path.join(root, 'android'))) {
  console.log('Creando proyecto Android de Capacitor…');
  run(npx, ['cap', 'add', 'android']);
}

console.log('Sincronizando Android…');
run(npx, ['cap', 'sync', 'android']);
console.log('Android listo.');
