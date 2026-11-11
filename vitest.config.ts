import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'worker/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    globals: false,
  },
  resolve: {
    alias: {
      '@tarot/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
});
