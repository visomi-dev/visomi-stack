import { test as base } from '@playwright/test';
import type { Pool } from 'pg';

import { resetAuthRateLimits, testDatabasePool } from '../support/database';
import { readTelemetry } from '../support/telemetry';

type HttpFixtures = {
  telemetry: { directory: string; read: typeof readTelemetry };
  database: Pool;
};

export const test = base.extend<HttpFixtures>({
  telemetry: async ({}, use) => {
    const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

    if (!directory) {
      throw new Error('isolated_telemetry_directory_required');
    }

    // webServer owns the destination; the test worker never initializes an SDK.
    await use({ directory, read: (target = directory) => readTelemetry(target) });
  },
  database: async ({}, use) => {
    const pool = await testDatabasePool();

    try {
      await use(pool);
    } finally {
      await pool.end();
    }
  },
});

export const authTest = test.extend<{ rateLimitIsolation: void }>({
  rateLimitIsolation: [
    async ({}, use) => {
      await resetAuthRateLimits();

      try {
        await use();
      } finally {
        await resetAuthRateLimits();
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
