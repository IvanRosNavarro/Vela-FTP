// Apunta vela-kit a una copia local para desarrollar kit y app a la vez.
//   pnpm kit:link [ruta]   ruta por defecto: ../Vela Kit
//   pnpm kit:unlink        vuelve al tag fijado en package.json
//
// Sustituye el enlace de node_modules sin pasar por `pnpm link`, que reescribe
// pnpm-lock.yaml y falla al deshacerse dentro de un workspace.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const CONSUMERS = ['packages/main', 'packages/renderer'];
const root = resolve(import.meta.dirname, '..');
const [mode, dirArg] = process.argv.slice(2);

const linkPath = (pkg) => resolve(root, pkg, 'node_modules', 'vela-kit');

if (mode === 'link') {
  const kitDir = resolve(root, dirArg ?? '../Vela Kit');
  if (!existsSync(resolve(kitDir, 'package.json'))) {
    console.error(`No hay vela-kit en ${kitDir}`);
    process.exit(1);
  }
  for (const pkg of CONSUMERS) {
    rmSync(linkPath(pkg), { recursive: true, force: true });
    // 'junction' no requiere permisos de administrador en Windows; se ignora en el resto.
    symlinkSync(kitDir, linkPath(pkg), 'junction');
  }
  console.log(`vela-kit enlazado a ${kitDir}. "pnpm kit:unlink" lo devuelve al tag.`);
} else if (mode === 'unlink') {
  for (const pkg of CONSUMERS) {
    rmSync(linkPath(pkg), { recursive: true, force: true });
  }
  execFileSync('pnpm', ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('vela-kit vuelve al tag de package.json.');
} else {
  console.error('Uso: node scripts/kit-link.mjs link [ruta] | unlink');
  process.exit(1);
}
