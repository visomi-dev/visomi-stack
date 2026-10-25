import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig } from '@playwright/test';

const temporaryRoot = join(workspaceRoot, 'tmp');

mkdirSync(temporaryRoot, { recursive: true });
const telemetryDirectory = process.env.VISOMI_E2E_TELEMETRY_DIR ?? mkdtempSync(join(temporaryRoot, 'api-e2e-'));

process.env.VISOMI_E2E_TELEMETRY_DIR = telemetryDirectory;

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './e2e' }),
  testMatch: '**/*.e2e.spec.ts',
  globalTeardown: './e2e/teardown.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3307', trace: 'off' },
  webServer: {
    command: 'pnpm exec tsx apps/web/api/e2e/serve.ts',
    url: 'http://127.0.0.1:3307',
    reuseExistingServer: false,
    cwd: workspaceRoot,
    env: {
      HOST: '127.0.0.1',
      PORT: '3307',
      NODE_ENV: 'test',
      VISOMI_E2E_TELEMETRY_DIR: telemetryDirectory,
      NODE_OPTIONS: `--require ${join(import.meta.dirname, 'e2e/telemetry-preload.cjs')}`,
    },
  },
  projects: [{ name: 'api' }],
});
