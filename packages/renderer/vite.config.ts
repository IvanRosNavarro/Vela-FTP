import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'),
) as { version: string };

// Con `pnpm kit:link` vela-kit vive fuera del repo y el dev server se
// negaría a servir sus ficheros.
const velaKitDir = realpathSync(resolve(__dirname, 'node_modules/vela-kit'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  base: './',
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@vela-ftp/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@': resolve(__dirname, 'src'),
    },
    // Con vela-kit enlazado, sus imports resolverían contra su propio
    // node_modules y habría dos React (hooks rotos) y dos stores de zustand.
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  // vela-kit es TypeScript fuente: preempaquetarlo deja en caché la versión
  // del tag y, al enlazar la copia local o subir de tag, se sirven exports
  // viejos ("does not provide an export named …").
  optimizeDeps: {
    exclude: ['vela-kit'],
  },
  server: {
    // 5173 es el de Vela Browser.
    port: 5183,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(__dirname), velaKitDir],
    },
  },
});
