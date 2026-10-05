import { ECDH } from 'node:crypto';

import { z } from 'zod';

function canonicalKey(value: string, bytes: number): boolean {
  const decoded = Buffer.from(value, 'base64url');

  return decoded.length === bytes && decoded.toString('base64url') === value;
}

function validPublicKey(value: string): boolean {
  if (!canonicalKey(value, 65)) return false;
  const decoded = Buffer.from(value, 'base64url');

  if (decoded[0] !== 4) return false;
  try {
    // Reject off-curve points, not only incorrect base64 lengths.
    ECDH.convertKey(decoded, 'prime256v1', undefined, undefined, 'uncompressed');

    return true;
  } catch {
    return false;
  }
}

function validVendorEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const vendor =
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.push\.apple\.com$/.test(url.hostname);

    // Require a canonical vendor URL. Reject credentials, redirects supplied as
    // query parameters, fragments, encoded host aliases and explicit ports.
    return (
      vendor &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname !== '/' &&
      value === url.href
    );
  } catch {
    return false;
  }
}

/** Parse again at delivery, including records loaded from persistence. Never follow redirects. */
export const pushSubscriptionInput = z.strictObject({
  endpoint: z.url().max(2048).refine(validVendorEndpoint, 'Unsupported push provider endpoint.'),
  keys: z.strictObject({
    p256dh: z
      .string()
      .length(87)
      .regex(/^[A-Za-z0-9_-]+$/)
      .refine(validPublicKey, 'Invalid P-256 public key.'),
    auth: z
      .string()
      .length(22)
      .regex(/^[A-Za-z0-9_-]+$/)
      .refine((value) => canonicalKey(value, 16), 'Invalid push authentication key.'),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;
