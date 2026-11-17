import { readFileSync } from 'node:fs';
import { createPublicKey, createPrivateKey, privateDecrypt, verify, webcrypto } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import {
  deviceChallengeSchema,
  deviceDeliveryLabel,
  deviceProofMessage,
  deviceDeliverySchema,
  type DeviceChallenge,
} from '@visomi-stack/shared-db';

import { decodeBytes } from './cipher';
import { WebCryptoDevices, type DeviceIdentity } from './devices';

const fixture = JSON.parse(
  readFileSync(new URL('../../../../../../shared/db/fixtures/devices-v1.json', import.meta.url), 'utf8'),
);
const challenge = deviceChallengeSchema.parse(fixture.challenge);
const delivery = deviceDeliverySchema.parse(fixture.delivery);
const devices = new WebCryptoDevices(webcrypto as unknown as Crypto);
let identity: DeviceIdentity;
let ownChallenge: DeviceChallenge;

beforeAll(async () => {
  const created = await devices.createIdentity();

  identity = created;
  const keys = await devices.publicKeys(identity);

  ownChallenge = { ...challenge, keys };
});

describe('device possession and contextual delivery', () => {
  it('snapshots a transient data key before asynchronous public-key import', async () => {
    const local = new Uint8Array(32).fill(7);
    const pending = devices.seal(local, delivery.binding);

    local.fill(0);
    const envelope = await pending;
    const key = await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(fixture.encryptionPrivatePkcs8, 'base64url'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const recovered = await devices.open(key as unknown as CryptoKey, delivery.binding, envelope);

    expect(recovered).toEqual(new Uint8Array(32).fill(7));
    recovered.fill(0);
  });
  it('verifies independent Node P1363 ECDSA bytes and OAEP label', async () => {
    expect(deviceProofMessage(challenge)).toBe(fixture.message);
    expect(deviceDeliveryLabel(delivery.binding)).toBe(fixture.label);
    const valid = await devices.verify({ ...challenge, proof: fixture.proof });
    const fingerprint = await devices.fingerprint(challenge);

    expect(valid).toBe(true);
    expect(fingerprint).toBe(delivery.binding.fingerprint);
    const key = await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(fixture.encryptionPrivatePkcs8, 'base64url'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const raw = await devices.open(key as unknown as CryptoKey, delivery.binding, delivery);

    expect(raw).toEqual(new Uint8Array(32).fill(7));
    raw.fill(0);
  });

  it('produces signatures accepted by Node and keeps private operational keys nonextractable', async () => {
    const proof = await devices.prove(identity, ownChallenge);
    const key = createPublicKey({ key: Buffer.from(proof.keys.signing, 'base64url'), format: 'der', type: 'spki' });

    expect(
      verify(
        'sha256',
        Buffer.from(deviceProofMessage(ownChallenge)),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(proof.proof, 'base64url'),
      ),
    ).toBe(true);
    const valid = await devices.verify(proof);

    expect(valid).toBe(true);
    for (const pair of [identity.signing, identity.encryption]) {
      expect(pair.privateKey.extractable).toBe(false);

      await expect(
        webcrypto.subtle.exportKey('pkcs8', pair.privateKey as unknown as webcrypto.CryptoKey),
      ).rejects.toThrow();
    }
  });

  it.each(['ownerId', 'deviceId', 'requestId', 'challenge', 'expiresAt', 'keys', 'key'] as const)(
    'binds possession proof to %s',
    async (field) => {
      const proof = { ...challenge, proof: fixture.proof };
      const changes = {
        ownerId: challenge.deviceId,
        deviceId: challenge.ownerId,
        requestId: challenge.ownerId,
        challenge: Buffer.alloc(32, 12).toString('base64url'),
        expiresAt: '2031-01-01T00:00:00.000Z',
        keys: ownChallenge.keys,
        key: { ...challenge.key, generation: 2 },
      };

      const valid = await devices.verify({ ...proof, [field]: changes[field] });

      expect(valid).toBe(false);
    },
  );

  it('rejects signing with a different identity and malformed proof', async () => {
    await expect(devices.prove(identity, challenge)).rejects.toMatchObject({ code: 'context-mismatch' });

    const malformed = await devices.verify({ ...challenge, proof: 'AA' });
    const extra = await devices.verify({ ...challenge, proof: fixture.proof, unknown: true });

    expect(malformed).toBe(false);
    expect(extra).toBe(false);
  });

  it('seals fresh randomized OAEP ciphertext independently decryptable by Node', async () => {
    const raw = new Uint8Array(32).fill(7);
    const first = await devices.seal(raw, delivery.binding);
    const second = await devices.seal(raw, delivery.binding);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    const opened = privateDecrypt(
      {
        key: createPrivateKey({
          key: Buffer.from(fixture.encryptionPrivatePkcs8, 'base64url'),
          format: 'der',
          type: 'pkcs8',
        }),
        oaepHash: 'sha256',
        oaepLabel: Buffer.from(fixture.label),
      },
      Buffer.from(first.ciphertext, 'base64url'),
    );

    expect(opened).toEqual(Buffer.from(raw));
    expect(raw).toEqual(new Uint8Array(32).fill(7));
    opened.fill(0);
  });

  it('rejects recipient substitution, damaged ciphertext, changed generation and wrong private key', async () => {
    const key = await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(fixture.encryptionPrivatePkcs8, 'base64url'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );

    await expect(
      devices.open(key as unknown as CryptoKey, { ...delivery.binding, ownerId: challenge.deviceId }, delivery),
    ).rejects.toMatchObject({ code: 'context-mismatch' });

    await expect(
      devices.open(key as unknown as CryptoKey, delivery.binding, {
        ...delivery,
        ciphertext: Buffer.alloc(384).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'integrity-failure' });

    await expect(devices.open(identity.encryption.privateKey, delivery.binding, delivery)).rejects.toMatchObject({
      code: 'integrity-failure',
    });

    const changed = { ...delivery.binding, key: { ...delivery.binding.key, generation: 2 } };

    await expect(
      devices.open(key as unknown as CryptoKey, changed, { ...delivery, binding: changed }),
    ).rejects.toMatchObject({ code: 'integrity-failure' });

    expect(decodeBytes(delivery.ciphertext, 384).length).toBe(384);
  });
});
