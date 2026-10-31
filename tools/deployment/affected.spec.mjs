import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['styles.base.css', 'e2e', ['web-app-e2e', 'web-gateway', 'web-site']],
  ['theme.base.js', 'e2e', ['web-app-e2e', 'web-gateway', 'web-site']],
  ['theme.base.js', 'lint', ['web-site']],
  ['apps/web/gateway/src/app.ts', 'e2e', ['web-gateway', 'web-site']],
  ['apps/web/api/src/app.ts', 'e2e', ['web-api', 'web-gateway', 'web-site']],
  ['.railway/railway.ts', 'deployment-check', ['web-gateway']],
  ['tools/deployment/smoke.mjs', 'deployment-check', ['web-gateway']],
  ['tools/deployment/smoke.mjs', 'container-check', ['web-gateway']],
  ['libs/backend/shared/src/lib/database/database.ts', 'container-check', ['web-gateway']],
  ['Dockerfile', 'container-check', ['web-gateway']],
  ['apps/web/app/src/app/app.ts', 'container-check', []],
  ['README.md', 'e2e', []],
  ['README.md', 'test', []],
  ['.github/workflows/ci.yml', 'e2e', ['web-api', 'web-app-e2e', 'web-gateway', 'web-site']],
];

for (const [file, target, expected] of cases) {
  test(`${file} selects the required ${target} projects`, () => {
    const result = execFileSync(
      'pnpm',
      ['nx', 'show', 'projects', '--affected', '-t', target, '--files', file, '--json'],
      {
        cwd,
        env: { ...process.env, NX_DAEMON: 'false' },
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    assert.deepEqual(JSON.parse(result).sort(), expected);
  });
}
