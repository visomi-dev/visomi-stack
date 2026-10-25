import { test as base } from '@playwright/test';

import { readTelemetry } from '../support/telemetry';

type TelemetryFixtures = {
  telemetry: { directory: string; read: typeof readTelemetry };
};

export const test = base.extend<TelemetryFixtures>({
  telemetry: async ({}, use) => {
    const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

    if (!directory) {
      throw new Error('isolated_telemetry_directory_required');
    }

    // webServer owns the destination; the test worker never initializes an SDK.
    await use({ directory, read: (target = directory) => readTelemetry(target) });
  },
});

export { expect } from '@playwright/test';
