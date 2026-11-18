import type { Page } from '@playwright/test';

// Covers the small visits opt-in check while the collector stays unloaded.
export const initialScriptBudget = 6784;

// Budget checks exercise the default error-only configuration; dedicated tests cover performance opt-in.
export async function disablePerformanceCapture(page: Page): Promise<void> {
  await page.route('**/telemetry/config', async (route) => {
    const response = await route.fetch();
    const configuration = await response.json();

    await route.fulfill({ response, json: { ...configuration, performance: false } });
  });
}
