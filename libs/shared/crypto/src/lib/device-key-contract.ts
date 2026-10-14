import { z } from 'zod';

import { decodeVaultBytes } from './vault-key-envelope';

function encodedBytes(minBytes: number, maxBytes = minBytes) {
  return z
    .string()
    .min(Math.ceil((minBytes * 8) / 6))
    .max(Math.ceil((maxBytes * 8) / 6))
    .refine((value) => {
      try {
        const length = Math.floor((value.length * 6) / 8);

        if (length < minBytes || length > maxBytes) return false;
        decodeVaultBytes(value, length);

        return true;
      } catch {
        return false;
      }
    }, 'Non-canonical device encoding');
}

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);

export const devicePairingInput = z.strictObject({
  version: z.literal(1),
  clientId: uuid,
  challenge: encodedBytes(32),
  expiresAt: z.iso.datetime(),
  keys: z.strictObject({ signing: encodedBytes(64, 256), encryption: encodedBytes(384, 1024) }),
});
export const devicePairing = devicePairingInput.extend({ proof: encodedBytes(64) });
export const deviceKeyBinding = z.strictObject({
  ownerUserId: uuid,
  workspaceId: uuid,
  clientId: uuid,
  challenge: encodedBytes(32),
  keyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const deviceKeyEnvelope = z.strictObject({ version: z.literal(1), ciphertext: encodedBytes(384) });

export type DevicePairing = z.infer<typeof devicePairing>;
export type DeviceKeyBinding = z.infer<typeof deviceKeyBinding>;
export type DeviceKeyEnvelope = z.infer<typeof deviceKeyEnvelope>;
