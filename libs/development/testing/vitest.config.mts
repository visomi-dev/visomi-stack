import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/development/testing',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'dev-testing',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests,e2e}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/development/testing',
      provider: 'v8' as const,
      enabled: true,
      include: ['{src,e2e,tests}/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
}));
