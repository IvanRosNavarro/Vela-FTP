import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@vela-ftp/shared': resolve(import.meta.dirname, '../shared/src/index.ts'),
    },
  },
});
