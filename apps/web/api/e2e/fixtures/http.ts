import type { Pool } from 'pg';
import { test as base } from '@visomi-stack/dev-testing/playwright';

import { resetAuthRateLimits, testDatabasePool } from '../support/database';

export const test = base.extend<{ database: Pool }>({
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

export { expect } from '@visomi-stack/dev-testing/playwright';
