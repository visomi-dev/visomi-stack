import { describe, expect, it } from 'vitest';

import { createOperationId, operationIdSchema, operationTimestamp, operationWindowMs } from './operations';
import { syntheticHybridPolicy } from './example';

describe('time-bound operation identifiers', () => {
  it('matches the public RFC 9562 A.6 UUIDv7 example and recovers its exact issuance time', () => {
    const now = 1645557742000;
    const source = {
      getRandomValues: (value: Uint8Array<ArrayBuffer>) => {
        value.set([0, 0, 0, 0, 0, 0, 0x0c, 0xc3, 0x18, 0xc4, 0xdc, 0x0c, 0x0c, 0x07, 0x39, 0x8f]);

        return value;
      },
    };
    const id = createOperationId(source, now);

    expect(id).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    expect(operationTimestamp(id)).toBe(now);
    expect(operationIdSchema.safeParse(id).success).toBe(true);
    expect(operationIdSchema.safeParse(id.toUpperCase()).success).toBe(false);
    expect(operationIdSchema.safeParse(id.replace('-7cc3', '-4cc3')).success).toBe(false);
  });

  it('rejects invalid clocks and retains independent random bits within the same millisecond', () => {
    for (const now of [-1, 1.5, NaN, Infinity, 0x1000000000000]) {
      expect(() => createOperationId(globalThis.crypto, now)).toThrow('operation_time_invalid');
    }

    const ids = new Set(Array.from({ length: 100 }, () => createOperationId(globalThis.crypto, 0xffffffffffff)));

    expect(ids.size).toBe(100);
    expect(operationTimestamp([...ids][0])).toBe(0xffffffffffff);
    expect(operationTimestamp(createOperationId(globalThis.crypto))).toBeLessThanOrEqual(Date.now());
  });

  it('keeps receipts through the complete offline/deletion/tombstone horizon, with at least one day', () => {
    const domain = structuredClone(syntheticHybridPolicy.domains[0]);

    Object.assign(domain.retention, { offlineWindowDays: 0, deletionGraceDays: 0, tombstoneDays: 0 });
    expect(operationWindowMs(domain)).toBe(86_400_000);
    domain.retention.offlineWindowDays = 7;
    expect(operationWindowMs(domain)).toBe(7 * 86_400_000);
    domain.retention.deletionGraceDays = 9;
    expect(operationWindowMs(domain)).toBe(9 * 86_400_000);
    domain.retention.tombstoneDays = 10;
    expect(operationWindowMs(domain)).toBe(10 * 86_400_000);
  });
});
