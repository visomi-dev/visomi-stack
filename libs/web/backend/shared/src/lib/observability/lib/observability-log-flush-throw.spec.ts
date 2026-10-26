import { describe, expect, it } from 'vitest';

import { currentObservability, initializeObservability } from './observability';

// A failed runtime remains process-wide; Vitest isolates terminal failure scenarios by file.
describe('terminal synchronous log flush failure', () => {
  it('contains a throwing destination and keeps replacement blocked', async () => {
    const destination = {
      write: () => undefined,
      flush: () => {
        throw new Error('SYNTHETIC_FLUSH_FAILURE');
      },
    };
    const runtime = initializeObservability({
      service: 'web-api',
      version: '0.0.1',
      destination,
    });
    const success = await runtime.shutdown();

    expect(success).toBe(false);
    expect(currentObservability()).toBe(runtime);
    expect(() => initializeObservability({ service: 'worker', version: '0.0.1' })).toThrow(
      'observability_shutdown_incomplete',
    );
  });
});
