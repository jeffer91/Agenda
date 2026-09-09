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
run(gradle, ['signingReport'], androidDir);

console.log('');
console.log('Busca la sección Variant: debug y copia el valor SHA1.');
console.log('En Google Cloud crea un OAuth Client ID tipo Android con:');
console.log('Package name: com.jeffer91.agenda');
