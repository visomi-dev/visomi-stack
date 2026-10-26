import { describe, expect, it } from 'vitest';

import { currentObservability, initializeObservability } from './observability';

// A failed runtime remains process-wide; Vitest isolates terminal failure scenarios by file.
describe('terminal log flush callback failure', () => {
  it('returns false, keeps the runtime registered and blocks replacement', async () => {
    const destination = {
      write: () => undefined,
      flush: (done: (error?: Error) => void) => done(new Error('SYNTHETIC_FLUSH_FAILURE')),
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
