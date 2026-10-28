import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const pin = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

export const token = () => randomBytes(16).toString('hex').toUpperCase();

export const digest = (secret: string, context: string, value: string) =>
  createHmac('sha256', secret).update(context).update('\0').update(value).digest('hex');

export function matches(actual: string, expected: string) {
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
