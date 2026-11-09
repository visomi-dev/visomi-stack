import { defineConfig } from 'rolldown';

import packageJson from './package.json' with { type: 'json' };

export default defineConfig([
  {
    input: { app: 'src/app.ts', main: 'src/main.ts' },
    platform: 'node',
    tsconfig: 'tsconfig.app.json',
    preserveEntrySignatures: 'strict',
    external: Object.keys(packageJson.dependencies),
    plugins: [
      {
        name: 'realtime-package-metadata',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'package.json',
            source: JSON.stringify({ ...packageJson, main: './app.js', exports: { '.': './app.js' } }, null, 2) + '\n',
          });
        },
      },
    ],
    output: {
      dir: '../../../dist/apps/web/realtime',
      cleanDir: true,
      format: 'es',
      sourcemap: true,
    },
  },
]);
