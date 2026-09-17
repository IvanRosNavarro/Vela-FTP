// Ejecuta un script con el Node embebido en Electron (ELECTRON_RUN_AS_NODE).
// Los tests de main lo usan para probar con el mismo runtime que la app:
// node:sqlite y crypto.argon2 de Node 24.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const result = spawnSync(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
