import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/web/backend/shared',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'web-backend-shared',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/web/backend/shared',
      provider: 'v8' as const,
    },
  },
}));
