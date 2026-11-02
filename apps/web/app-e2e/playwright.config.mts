import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
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
