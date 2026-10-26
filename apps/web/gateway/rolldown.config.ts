import { defineConfig } from 'rolldown';

import packageJson from './package.json' with { type: 'json' };

// Installed at runtime instead of bundled (native addons, dynamic requires).
const dependencies = Object.keys(packageJson.dependencies);

export default defineConfig([
  {
    input: { app: 'src/app.ts', main: 'src/main.ts' },
    preserveEntrySignatures: 'strict',
    platform: 'node',
    tsconfig: 'tsconfig.app.json',
    external: (id) =>
      id === '@nx/js/ready-signal' || dependencies.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    plugins: [
      {
        name: 'gateway-package-metadata',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'package.json',
            source:
              JSON.stringify(
                {
                  name: packageJson.name,
                  version: packageJson.version,
                  private: true,
                  type: 'module',
                  main: './app.js',
                  exports: { '.': './app.js', './app': './app.js' },
                  dependencies: packageJson.dependencies,
                },
                null,
                2,
              ) + '\n',
          });
        },
      },
    ],
    output: {
      dir: '../../../dist/apps/web/gateway',
      cleanDir: true,
      format: 'es',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      sourcemap: true,
    },
  },
]);
