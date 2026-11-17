import { z } from 'zod';

import type { DomainPolicy } from './policy';

/** RFC 9562 UUIDv7: the immutable ID binds issuance time, including after receipt deletion. */
export const operationIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const operationClockSkewMs = 300_000;
export const retentionDayMs = 86_400_000;

export function operationWindowMs(policy: Pick<DomainPolicy, 'retention'>): number {
  return (
    Math.max(
      1,
      policy.retention.offlineWindowDays,
      policy.retention.deletionGraceDays,
      policy.retention.tombstoneDays,
    ) * retentionDayMs
  );
}

export function operationTimestamp(id: string): number {
  return Number.parseInt(operationIdSchema.parse(id).slice(0, 13).replace('-', ''), 16);
}

/** The runtime supplies a cryptographically secure random source. No sorting/monotonicity claim. */
export function createOperationId(
  source: { getRandomValues(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> },
  now = Date.now(),
): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError('operation_time_invalid');
  }

  const bytes = source.getRandomValues(new Uint8Array(16));

  for (let index = 5, time = now; index >= 0; index--, time = Math.floor(time / 256)) {
    bytes[index] = time % 256;
  }

  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
