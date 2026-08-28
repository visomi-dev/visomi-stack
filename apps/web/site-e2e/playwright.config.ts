import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

const gatewayPort = process.env['GATEWAY_PORT'] || '8082';
const baseURL = process.env['BASE_URL'] || `http://localhost:${gatewayPort}`;

export default defineConfig({
  ...nxE2EPreset(__filename, {
    testDir: './src',
    openHtmlReport: 'never',
  }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node dist/apps/web/server/main.js',
    url: `${baseURL}/en/`,
    reuseExistingServer: false,
    cwd: workspaceRoot,
    env: {
      ...process.env,
      DATABASE_AUTO_MIGRATE: 'true',
      DATABASE_DRIVER: 'memory',
      ENABLE_TEST_API: 'true',
      HOST: 'localhost',
      GATEWAY_PORT: gatewayPort,
      MAIL_TRANSPORT: 'memory',
      NG_ALLOWED_HOSTS: 'localhost',
      PORT: gatewayPort,
      SESSION_SECRET: 'themis-site-e2e-secret',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
