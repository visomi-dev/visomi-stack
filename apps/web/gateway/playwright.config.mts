import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig } from '@playwright/test';

const temporaryRoot = join(workspaceRoot, 'tmp/api-e2e');

mkdirSync(temporaryRoot, { recursive: true });
const directory = process.env.VISOMI_E2E_TELEMETRY_DIR ?? mkdtempSync(join(temporaryRoot, 'gateway-run-'));

process.env.VISOMI_E2E_TELEMETRY_DIR = directory;

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './e2e' }),
  testMatch: '**/*.e2e.spec.ts',
  globalTeardown: '../../../e2e/support/teardown.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3317', trace: 'off' },
  webServer: {
    command: 'pnpm exec tsx e2e/support/serve.ts',
    url: 'http://127.0.0.1:3317/api/',
    reuseExistingServer: false,
    cwd: workspaceRoot,
    env: {
      HOST: '127.0.0.1',
      PORT: '3317',
      NODE_ENV: 'test',
      AUTH_TRUST_PROXY: '',
      VISOMI_E2E_APPLICATION: 'web-gateway',
      VISOMI_E2E_TELEMETRY_DIR: directory,
      NODE_OPTIONS: `--require ${join(workspaceRoot, 'e2e/support/telemetry-preload.cjs')}`,
    },
  },
  projects: [{ name: 'gateway' }],
});
