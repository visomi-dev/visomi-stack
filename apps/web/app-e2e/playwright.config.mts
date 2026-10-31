import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: { baseURL: 'http://127.0.0.1:4202', trace: 'off' },
  webServer: {
    command: 'node dist/apps/web/app/server/server.mjs',
    url: 'http://127.0.0.1:4202/app/en/',
    cwd: workspaceRoot,
    env: {
      HOST: '127.0.0.1',
      PORT: '4202',
      NODE_ENV: 'test',
      VISOMI_BROWSER_TELEMETRY: 'true',
      BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1:4202',
    },
    reuseExistingServer: false,
  },
  projects: [{ name: 'angular-chromium', metadata: { application: 'angular' }, use: { ...devices['Desktop Chrome'] } }],
});
