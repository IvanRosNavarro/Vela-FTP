import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'),
) as { version: string };

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
  },
  server: {
    // 5173 es el de Vela Browser.
    port: 5183,
    strictPort: true,
  },
});
