import { test as base } from '@visomi-stack/dev-testing/playwright';

import { resetAuthRateLimits } from '../support/database';

export const test = base;

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
