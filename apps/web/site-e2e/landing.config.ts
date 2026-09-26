import { resolve } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './visual',
  outputDir: process.env['LANDING_OUTPUT_DIR'] || resolve(workspaceRoot, 'dist/.playwright/landing'),
  snapshotPathTemplate: `${process.env['LANDING_BASELINE_DIR'] || resolve(workspaceRoot, 'dist/.playwright/landing-baselines')}/{arg}{ext}`,
  updateSnapshots: 'none',
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm nx run site:serve',
    // Keep Astro 7 attached to Playwright instead of auto-detaching in agent environments.
    env: { ASTRO_DEV_BACKGROUND: '1', NX_NATIVE_COMMAND_RUNNER: 'false' },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    cwd: workspaceRoot,
    url: 'http://127.0.0.1:4200/en/',
    reuseExistingServer: false,
  },
});
