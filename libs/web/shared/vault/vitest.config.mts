import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/web/shared/vault',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'web-shared-vault',
    watch: false,
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/web/shared/vault',
      provider: 'v8' as const,
    },
  },
}));
