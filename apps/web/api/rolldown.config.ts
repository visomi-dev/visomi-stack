import { defineConfig } from 'rolldown';

import packageJson from './package.json' with { type: 'json' };

const dependencies = Object.keys(packageJson.dependencies ?? {});

export default defineConfig([
  {
    input: {
      app: 'src/app.ts',
      main: 'src/main.ts',
    },
    platform: 'node',
    tsconfig: 'tsconfig.app.json',
    preserveEntrySignatures: 'strict',
    external: (id) =>
      dependencies.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    output: {
      dir: '../../../dist/apps/web/api',
      cleanDir: true,
      format: 'cjs',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      sourcemap: true,
    },
  },
]);
