import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
        name: 'gateway-runtime-assets',
        generateBundle() {
          const manifest = new URL('../../../assets/brand/public.json', import.meta.url);

          this.addWatchFile(fileURLToPath(manifest));
          const publicBrand = JSON.parse(readFileSync(manifest, 'utf8')) as { files: string[] };

          for (const file of publicBrand.files) {
            const source = new URL(`../../../assets/brand/${file}`, import.meta.url);

            this.addWatchFile(fileURLToPath(source));
            this.emitFile({
              type: 'asset',
              fileName: `static/brand/${file}`,
              source: readFileSync(source),
            });
          }

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
