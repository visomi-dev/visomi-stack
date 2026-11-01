import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/apps/web/edge',
  test: {
    name: 'web-edge',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/worker.ts'],
      reportsDirectory: '../../../coverage/apps/web/edge',
      reporter: ['text', 'lcov'],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
