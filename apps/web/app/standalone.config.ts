import { isAbsolute } from 'node:path';

import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/standalone.ts',
  platform: 'node',
  tsconfig: 'tsconfig.app.json',
  external: (id) => !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('@visomi-stack/'),
  plugins: [
    {
      name: 'compiled-angular-composition',
      resolveId(source) {
        return source === './server' ? { id: './server.mjs', external: true } : null;
      },
    },
  ],
  output: {
    file: '../../../dist/apps/web/app/server/standalone.mjs',
    format: 'es',
    sourcemap: true,
  },
});
