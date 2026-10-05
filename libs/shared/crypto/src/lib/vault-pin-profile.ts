import { z } from 'zod';

import { decodeVaultBytes, encodeVaultBytes } from './vault-key-envelope';
import { isVaultPinValid } from './vault-pin-policy';

const binding = z.strictObject({ ownerUserId: z.uuid(), personalScopeId: z.uuid(), methodId: z.uuid() });

export const vaultPinProfile = z.strictObject({
  version: z.literal(1),
  binding,
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z
    .string()
    .min(22)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export type VaultPinProfile = z.infer<typeof vaultPinProfile>;
const verifier = z.strictObject({ version: z.literal(1), salt: z.string(), digest: z.string() });

function aad(value: z.infer<typeof binding>): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify(['visomi-vault-pin-profile-v1', value.ownerUserId, value.personalScopeId, value.methodId]),
  );
}

async function digest(crypto: Crypto, pin: string, salt: string): Promise<string> {
  if (!isVaultPinValid(pin)) throw new Error('invalid_vault_pin');
  decodeVaultBytes(salt, 32);
  const bytes = new TextEncoder().encode(JSON.stringify(['visomi-vault-pin-verifier-v1', salt, pin]));

  try {
    return encodeVaultBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  } finally {
    bytes.fill(0);
  }
}

/** The verifier is DEK-encrypted, never PIN-encrypted or sent in plaintext to the server. */
export async function sealVaultPinProfile(
  crypto: Crypto,
  dataKey: CryptoKey,
  pin: string,
  scope: z.infer<typeof binding>,
): Promise<VaultPinProfile> {
  const parsed = binding.parse(scope);
  const salt = encodeVaultBytes(crypto.getRandomValues(new Uint8Array(32)));
  const value = await digest(crypto, pin, salt);
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, salt, digest: value }));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(parsed) },
      dataKey,
      bytes,
    );

    return vaultPinProfile.parse({
      version: 1,
      binding: parsed,
      iv: encodeVaultBytes(iv),
      ciphertext: encodeVaultBytes(new Uint8Array(ciphertext)),
    });
  } finally {
    bytes.fill(0);
  }
}

async function openVaultPinProfile(
  crypto: Crypto,
  dataKey: CryptoKey,
  input: VaultPinProfile,
  expected: z.infer<typeof binding>,
): Promise<{ version: 1; salt: string; digest: string }> {
  const profile = vaultPinProfile.parse(input);
  const scope = binding.parse(expected);

  if (JSON.stringify(profile.binding) !== JSON.stringify(scope)) throw new Error('vault_scope_mismatch');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeVaultBytes(profile.iv, 12), additionalData: aad(scope) },
    dataKey,
    decodeVaultBytes(profile.ciphertext, Math.floor((profile.ciphertext.length * 6) / 8)),
  );
  const bytes = new Uint8Array(plaintext);

  try {
    const parsed = verifier.parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);

    decodeVaultBytes(parsed.salt, 32).fill(0);
    decodeVaultBytes(parsed.digest, 32).fill(0);

    return parsed;
  } finally {
    bytes.fill(0);
  }
}

export async function matchesVaultPinProfile(
  crypto: Crypto,
  dataKey: CryptoKey,
  pin: string,
  input: VaultPinProfile,
  expected: z.infer<typeof binding>,
): Promise<boolean> {
  const parsed = await openVaultPinProfile(crypto, dataKey, input, expected);
  const actual = decodeVaultBytes(await digest(crypto, pin, parsed.salt), 32);
  const expectedDigest = decodeVaultBytes(parsed.digest, 32);
  let difference = 0;

  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expectedDigest[index];
  actual.fill(0);
  expectedDigest.fill(0);

  return difference === 0;
}

/** Validates recovery/envelope key continuity without exposing the decrypted verifier. */
export async function verifyVaultPinProfileKey(
  crypto: Crypto,
  dataKey: CryptoKey,
  input: VaultPinProfile,
  expected: z.infer<typeof binding>,
): Promise<void> {
  await openVaultPinProfile(crypto, dataKey, input, expected);
}
