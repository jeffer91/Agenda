import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join(root, 'scripts', 'android-setup.mjs')]);

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log('Compilando APK debug…');
run(gradle, ['assembleDebug'], androidDir);

const source = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(source)) {
  console.error('La compilación terminó, pero no se encontró app-debug.apk.');
  process.exit(1);
}

const artifacts = path.join(root, 'artifacts');
await fsp.mkdir(artifacts, { recursive: true });
const target = path.join(artifacts, 'Agenda-debug.apk');
await fsp.copyFile(source, target);

console.log('');
console.log('APK creado correctamente:');
console.log(target);
