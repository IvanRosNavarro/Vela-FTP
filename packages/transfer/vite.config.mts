import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Dependencias con módulos nativos opcionales o require dinámicos: van en
      // el package.json raíz y electron-builder las empaqueta tal cual.
      external: ['electron', 'basic-ftp', 'ssh2', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'cjs' },
    },
  },
  resolve: {
    alias: {
      '@vela-ftp/shared': resolve(import.meta.dirname, '../shared/src/index.ts'),
    },
  },
});
