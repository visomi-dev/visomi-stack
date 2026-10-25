import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/apps/web/api',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'web-api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', '../../../e2e/support/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/apps/web/api',
      provider: 'v8' as const,
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
}));
