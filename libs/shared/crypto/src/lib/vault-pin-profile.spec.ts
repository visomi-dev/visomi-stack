import { webcrypto } from 'node:crypto';

import { matchesVaultPinProfile, sealVaultPinProfile } from './vault-pin-profile';

const crypto = webcrypto as unknown as Crypto;
const scope = {
  ownerUserId: '3dd47d93-4464-4326-b143-e9e99e4a5a40',
  personalScopeId: 'c31e0555-de8d-4b6b-9860-fe5615ba7c5f',
  methodId: '814988e3-928a-4ebf-b282-6616e7f680b1',
};

describe('DEK-encrypted canonical PIN profile', () => {
  it('validates the canonical PIN only after DEK decryption and never serializes a clear verifier', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const profile = await sealVaultPinProfile(crypto, key, '829374', scope);

    expect(await matchesVaultPinProfile(crypto, key, '829374', profile, scope)).toBe(true);
    expect(await matchesVaultPinProfile(crypto, key, '829375', profile, scope)).toBe(false);
    expect(JSON.stringify(profile)).not.toContain('829374');
    expect(JSON.stringify(profile)).not.toContain('digest');
    expect(JSON.stringify(profile)).not.toContain('salt');
  });

  it('rejects foreign bindings, modified ciphertext and a different DEK', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const wrong = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const profile = await sealVaultPinProfile(crypto, key, '829374', scope);

    await expect(matchesVaultPinProfile(crypto, wrong, '829374', profile, scope)).rejects.toThrow();
    await expect(
      matchesVaultPinProfile(crypto, key, '829374', profile, {
        ...scope,
        personalScopeId: 'ecfa2ae8-a073-49a7-a2c7-02350ee9a8fd',
      }),
    ).rejects.toThrow('vault_scope_mismatch');
    const ciphertext = (profile.ciphertext[0] === 'A' ? 'B' : 'A') + profile.ciphertext.slice(1);

    await expect(matchesVaultPinProfile(crypto, key, '829374', { ...profile, ciphertext }, scope)).rejects.toThrow();
  });

  it.each(['123456', '000000', '654321', '8293740', 'abcdef'])('keeps the worker PIN policy for %s', async (pin) => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

    await expect(sealVaultPinProfile(crypto, key, pin, scope)).rejects.toThrow('invalid_vault_pin');
  });
});
