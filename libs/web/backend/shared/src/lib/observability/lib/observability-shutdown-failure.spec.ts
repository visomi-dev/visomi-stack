import { describe, expect, it } from 'vitest';

import { currentObservability, initializeObservability } from './observability';

// Vitest isolates this file: a failed runtime must remain registered until its process ends.
describe('terminal runtime shutdown failure', () => {
  it('returns false and blocks initialization after a rejected sink shutdown', async () => {
    const telemetry = initializeObservability({
      service: 'web-api',
      version: '0.0.1',
      destination: { write: () => undefined },
      spanExporter: {
        export: (_spans, callback) => callback({ code: 0 }),
        shutdown: () => Promise.reject(new Error('SYNTHETIC_SHUTDOWN_FAILURE')),
      },
    });
    const first = telemetry.shutdown();
    const success = await first;

    expect(success).toBe(false);
    expect(telemetry.shutdown()).toBe(first);
    expect(currentObservability()).toBe(telemetry);
    expect(() => initializeObservability({ service: 'worker', version: '1.0.0' })).toThrow(
      'observability_shutdown_incomplete',
    );
  });
});
