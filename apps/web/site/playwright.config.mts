import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './e2e' }),
  use: { baseURL: 'http://127.0.0.1:3320', trace: 'off' },
  webServer: {
    command: 'node dist/apps/web/gateway/main.js',
    url: 'http://127.0.0.1:3320/en/',
    cwd: workspaceRoot,
    env: {
      HOST: '127.0.0.1',
      PORT: '3320',
      NODE_ENV: 'test',
      DATABASE_URL: '',
      API_APP_PATH: '',
      SITE_APP_PATH: '',
      VISOMI_BROWSER_TELEMETRY: 'true',
      BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1:3320',
    },
    reuseExistingServer: false,
  },
  projects: [
    { name: 'astro-express-chromium', metadata: { application: 'astro' }, use: { ...devices['Desktop Chrome'] } },
  ],
});
