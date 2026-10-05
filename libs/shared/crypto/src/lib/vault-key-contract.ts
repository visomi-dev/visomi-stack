import { z } from 'zod';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const canonicalUuid = z.uuid().regex(/^[0-9a-f-]+$/);

function binary(minBytes: number, maxBytes = minBytes) {
  return z
    .string()
    .min(Math.ceil((minBytes * 8) / 6))
    .max(Math.ceil((maxBytes * 8) / 6))
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => {
      const remainder = value.length % 4;
      const bytes = Math.floor((value.length * 6) / 8);
      const last = alphabet.indexOf(value[value.length - 1] ?? '');

      return (
        remainder !== 1 &&
        bytes >= minBytes &&
        bytes <= maxBytes &&
        (remainder === 0 || (remainder === 2 && last % 16 === 0) || (remainder === 3 && last % 4 === 0))
      );
    }, 'Non-canonical base64url');
}

const commonBinding = {
  ownerUserId: canonicalUuid,
  personalScopeId: canonicalUuid,
  methodId: canonicalUuid,
  keyGeneration: z.literal(1),
};

export const prfKeyBinding = z.strictObject({
  ...commonBinding,
  methodKind: z.literal('passkey-prf'),
  credentialId: binary(1, 1024),
});
export const pinKeyBinding = z.strictObject({
  ...commonBinding,
  methodKind: z.literal('local-pin'),
  browserId: canonicalUuid,
});
export const vaultKeyBinding = z.discriminatedUnion('methodKind', [prfKeyBinding, pinKeyBinding]);

const commonEnvelope = {
  version: z.literal(1),
  hkdfSalt: binary(32),
  iv: binary(12),
  ciphertext: binary(48),
};

export const prfKeyEnvelope = z
  .strictObject({
    ...commonEnvelope,
    binding: prfKeyBinding,
    prfInput: binary(32),
    kdfProfile: z.literal('prf-hkdf-sha256-v1'),
  })
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096);
export const localPinEnvelope = z
  .strictObject({
    ...commonEnvelope,
    binding: pinKeyBinding,
    argon2Salt: binary(16),
    kdfProfile: z.literal('pin-argon2id-hkdf-sha256-v1'),
  })
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096);
export const vaultKeyEnvelope = z.union([prfKeyEnvelope, localPinEnvelope]);

export type VaultKeyBinding = z.infer<typeof vaultKeyBinding>;
export type PrfKeyBinding = z.infer<typeof prfKeyBinding>;
export type PrfKeyEnvelope = z.infer<typeof prfKeyEnvelope>;
export type LocalPinEnvelope = z.infer<typeof localPinEnvelope>;
export type VaultKeyEnvelope = z.infer<typeof vaultKeyEnvelope>;
export type VaultKeyEnvelopeMetadata =
  Omit<PrfKeyEnvelope, 'iv' | 'ciphertext'> | Omit<LocalPinEnvelope, 'iv' | 'ciphertext'>;
