import { webcrypto } from 'node:crypto';

import { browserVaultBinding } from './vault-browser-contract';
import { createDeviceIdentity } from './device-key-delivery';
import {
  browserVaultFingerprint,
  createBrowserVaultPairing,
  openBrowserVaultKey,
  sealBrowserVaultKey,
  signBrowserVaultConsume,
  verifyBrowserVaultConsume,
  verifyBrowserVaultPairing,
} from './vault-browser-enrollment';

const crypto = webcrypto as unknown as Crypto;

describe('context-bound signed browser vault delivery', () => {
  it('authenticates recipient/context and delivers only to the non-extractable requesting identity', async () => {
    const { identity, pairing } = await createBrowserVaultPairing(
      crypto,
      crypto.randomUUID(),
      crypto.randomUUID(),
      '2026-10-04T01:00:00Z',
    );
    const fingerprint = await browserVaultFingerprint(crypto, pairing);
    const binding = browserVaultBinding.parse({
      ownerUserId: pairing.ownerUserId,
      personalScopeId: pairing.personalScopeId,
      requestId: pairing.requestId,
      challenge: pairing.challenge,
      fingerprint,
      recipientEncryption: pairing.keys.encryption,
      keyGeneration: 1,
    });
    const plaintext = new Uint8Array(32).fill(42);
    const delivery = await sealBrowserVaultKey(crypto, plaintext, binding);
    const opened = await openBrowserVaultKey(crypto, identity.encryption.privateKey, binding, delivery);

    expect(opened).toEqual(plaintext);
    opened.fill(0);
    plaintext.fill(0);
    expect(identity.encryption.privateKey.extractable).toBe(false);
    expect(identity.signing.privateKey.extractable).toBe(false);
    expect(await verifyBrowserVaultPairing(crypto, pairing)).toBe(true);
    for (const field of ['ownerUserId', 'personalScopeId', 'requestId'] as const) {
      expect(await verifyBrowserVaultPairing(crypto, { ...pairing, [field]: crypto.randomUUID() })).toBe(false);
      await expect(
        openBrowserVaultKey(
          crypto,
          identity.encryption.privateKey,
          { ...binding, [field]: crypto.randomUUID() },
          delivery,
        ),
      ).rejects.toThrow();
    }
    await expect(
      openBrowserVaultKey(
        crypto,
        identity.encryption.privateKey,
        { ...binding, fingerprint: 'A'.repeat(43) },
        delivery,
      ),
    ).rejects.toThrow();
    const foreign = await createDeviceIdentity(crypto);

    await expect(openBrowserVaultKey(crypto, foreign.encryption.privateKey, binding, delivery)).rejects.toThrow();
  });

  it('requires signed consumption bound to the exact pairing, timestamp and nonce', async () => {
    const { identity, pairing } = await createBrowserVaultPairing(
      crypto,
      crypto.randomUUID(),
      crypto.randomUUID(),
      '2026-10-04T01:00:00Z',
    );
    const proof = await signBrowserVaultConsume(crypto, identity.signing.privateKey, pairing, {
      nonce: crypto.randomUUID(),
      issuedAt: '2026-10-04T00:59:00Z',
    });

    expect(await verifyBrowserVaultConsume(crypto, pairing, proof)).toBe(true);
    expect(await verifyBrowserVaultConsume(crypto, pairing, { ...proof, nonce: crypto.randomUUID() })).toBe(false);
    expect(await verifyBrowserVaultConsume(crypto, pairing, { ...proof, issuedAt: '2026-10-04T00:58:00Z' })).toBe(
      false,
    );
    expect(await verifyBrowserVaultConsume(crypto, { ...pairing, requestId: crypto.randomUUID() }, proof)).toBe(false);
    expect(
      await verifyBrowserVaultPairing(crypto, { ...pairing, keys: { ...pairing.keys, encryption: 'A'.repeat(512) } }),
    ).toBe(false);
  });
});
