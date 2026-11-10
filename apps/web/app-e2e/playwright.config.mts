import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

const foundations = defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: { baseURL: 'http://127.0.0.1:4202', trace: 'off' },
  webServer: [
    {
      command: 'node dist/apps/web/app/server/standalone.mjs',
      url: 'http://127.0.0.1:4202/app/en/',
      cwd: workspaceRoot,
      env: {
        HOST: '127.0.0.1',
        PORT: '4202',
        NODE_ENV: 'test',
        VISOMI_BROWSER_TELEMETRY: 'true',
        VISOMI_BROWSER_PERFORMANCE: 'true',
        BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1:4202',
      },
      reuseExistingServer: false,
    },
    {
      command: 'node dist/apps/web/gateway/main.js',
      url: 'http://127.0.0.1:4203/api/',
      cwd: workspaceRoot,
      env: {
        HOST: '127.0.0.1',
        PORT: '4203',
        NODE_ENV: 'test',
        DATABASE_URL: '',
        API_APP_PATH: '',
        SITE_APP_PATH: '',
        APPLICATION_APP_PATH: '',
        VISOMI_BROWSER_TELEMETRY: 'true',
        VISOMI_BROWSER_PERFORMANCE: 'true',
        BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1:4203',
      },
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: 'angular-chromium', metadata: { application: 'angular' }, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'gateway-angular-chromium',
      metadata: { application: 'angular' },
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4203' },
    },
  ],
});

const authMode = process.env['VISOMI_AUTH_E2E'] === 'true';

if (authMode) {
  const temporaryRoot = join(workspaceRoot, 'tmp/auth-ui-e2e');

  mkdirSync(temporaryRoot, { recursive: true });
  process.env['VISOMI_E2E_TELEMETRY_DIR'] ??= mkdtempSync(join(temporaryRoot, 'run-'));
}

export default defineConfig(
  authMode
    ? {
        ...nxE2EPreset(import.meta.dirname, { testDir: './auth' }),
        testMatch: '**/*.auth.spec.ts',
        outputDir: join(workspaceRoot, 'dist/.playwright/apps/web/app-e2e/auth-output'),
        workers: 1,
        timeout: 60000,
        use: { baseURL: 'http://localhost:4204', trace: 'off' },
        globalTeardown: './auth/support/teardown.ts',
        webServer: {
          command: 'pnpm exec tsx --tsconfig apps/web/app-e2e/tsconfig.json apps/web/app-e2e/auth/support/serve.ts',
          url: 'http://localhost:4204/api/',
          cwd: workspaceRoot,
          timeout: 120000,
          reuseExistingServer: false,
          env: {
            VISOMI_E2E_TELEMETRY_DIR: process.env['VISOMI_E2E_TELEMETRY_DIR']!,
            ...(process.env['VISOMI_TEST_COMPOSE'] ? { VISOMI_TEST_COMPOSE: process.env['VISOMI_TEST_COMPOSE'] } : {}),
          },
        },
        projects: [
          { name: 'auth-chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'auth-firefox', testIgnore: '**/passkeys.auth.spec.ts', use: { ...devices['Desktop Firefox'] } },
          { name: 'auth-webkit', testIgnore: '**/passkeys.auth.spec.ts', use: { ...devices['Desktop Safari'] } },
        ],
      }
    : foundations,
);
