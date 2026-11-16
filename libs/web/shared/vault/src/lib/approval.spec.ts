import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import {
  approvedDeliverySchema,
  deviceChallengeSchema,
  deviceActionMessage,
  deviceDeliveryLabel,
  deviceProofMessage,
  type ApprovedDelivery,
  type DeliveryBinding,
  type SigningPin,
} from '@visomi-stack/shared-persistence';

import { encodeBytes } from './crypto';
import { WebCryptoDevices, type DeviceIdentity } from './devices';

const reference = JSON.parse(
  readFileSync(new URL('../../../../../shared/persistence/fixtures/devices-v1.json', import.meta.url), 'utf8'),
);
const historyReference = JSON.parse(
  readFileSync(new URL('../../../../../shared/persistence/fixtures/devices-history-v1.json', import.meta.url), 'utf8'),
);
const devices = new WebCryptoDevices(webcrypto as unknown as Crypto);
let recipient: DeviceIdentity;
let signer: DeviceIdentity;
let pin: SigningPin;
let binding: DeliveryBinding;
let approved: ApprovedDelivery;

beforeAll(async () => {
  const first = await devices.createIdentity();

  recipient = first;
  const second = await devices.createIdentity();

  signer = second;
  const keys = await devices.publicKeys(recipient);
  const signing = await devices.publicKeys(signer);

  pin = { deviceId: reference.challenge.deviceId, signing: signing.signing };
  const challenge = deviceChallengeSchema.parse({ ...reference.challenge, keys });
  const proof = await devices.prove(recipient, challenge);
  const fingerprint = await devices.fingerprint(challenge);

  binding = {
    key: challenge.key,
    ownerId: challenge.ownerId,
    deviceId: challenge.deviceId,
    requestId: challenge.requestId,
    challenge: challenge.challenge,
    fingerprint,
    encryption: keys.encryption,
  };
  const delivery = await devices.seal(new Uint8Array(32).fill(7), binding);
  const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(JSON.stringify({ proof, delivery })));
  const authorization = await devices.signAction(signer, {
    key: challenge.key,
    deviceId: pin.deviceId,
    operationId: challenge.requestId,
    epoch: 1,
    action: 'approve',
    bodyHash: encodeBytes(new Uint8Array(digest)),
  });

  approved = approvedDeliverySchema.parse({
    format: 'visomi.approved-device-key',
    version: 1,
    delivery,
    authorization,
    witness: { kind: 'enrollment', proof, delivery },
  });
});

describe('client-verifiable recipient approval', () => {
  it('decodes the independent public Node historical-grant fixture without changing its signed bytes', async () => {
    const value = approvedDeliverySchema.parse(historyReference.approval);
    const privateKey = await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(reference.encryptionPrivatePkcs8, 'base64url'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );

    if (value.witness.kind !== 'enrollment' || !value.witness.history) {
      throw new Error('synthetic_history_required');
    }

    expect(deviceProofMessage(value.witness.proof)).toBe(historyReference.message);
    expect(deviceActionMessage(value.authorization)).toBe(historyReference.approvalMessage);
    expect(deviceDeliveryLabel(value.delivery.binding)).toBe(historyReference.currentLabel);
    expect(deviceDeliveryLabel(value.witness.history[0].binding)).toBe(historyReference.historicalLabel);
    const trusted = { deviceId: value.authorization.deviceId, signing: reference.challenge.keys.signing };
    const current = await devices.accept(privateKey as unknown as CryptoKey, value.delivery.binding, value, trusted);
    const historical = await devices.accept(
      privateKey as unknown as CryptoKey,
      value.delivery.binding,
      value,
      trusted,
      1,
    );

    try {
      expect(Buffer.from(current).toString('hex')).toBe(historyReference.currentDataKeyHex);
      expect(Buffer.from(historical).toString('hex')).toBe(historyReference.historicalDataKeyHex);
      expect(current).not.toEqual(historical);
    } finally {
      current.fill(0);
      historical.fill(0);
    }
  });
  it('opens only exact historically granted keys under the current approval signature and trusted pin', async () => {
    const keys = await devices.publicKeys(recipient);
    const challenge = deviceChallengeSchema.parse({
      ...reference.challenge,
      key: { ...binding.key, generation: 2 },
      keys,
    });
    const proof = await devices.prove(recipient, challenge);
    const fingerprint = await devices.fingerprint(proof);
    const expected = { ...binding, key: challenge.key, fingerprint };
    const delivery = await devices.seal(new Uint8Array(32).fill(23), expected);
    const historical = await devices.seal(new Uint8Array(32).fill(7), { ...expected, key: binding.key });
    const body = { proof, delivery, history: [historical] };
    const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(JSON.stringify(body)));
    const { signature: _signature, ...action } = approved.authorization;
    const authorization = await devices.signAction(signer, {
      ...action,
      key: expected.key,
      epoch: 3,
      bodyHash: encodeBytes(new Uint8Array(digest)),
    });
    const value = approvedDeliverySchema.parse({
      ...approved,
      delivery,
      authorization,
      witness: { kind: 'enrollment', ...body },
    });
    const raw = await devices.accept(recipient.encryption.privateKey, expected, value, pin, 1);

    expect(raw).toEqual(new Uint8Array(32).fill(7));
    raw.fill(0);
    const latest = await devices.accept(recipient.encryption.privateKey, expected, value, pin);

    expect(latest).toEqual(new Uint8Array(32).fill(23));
    latest.fill(0);

    for (const history of [
      [historical, historical],
      [delivery],
      [{ ...historical, binding: { ...historical.binding, deviceId: binding.ownerId } }],
    ]) {
      await expect(
        devices.accept(
          recipient.encryption.privateKey,
          expected,
          {
            ...value,
            witness: { kind: 'enrollment', ...body, history },
          },
          pin,
          1,
        ),
      ).rejects.toMatchObject({ code: 'context-mismatch' });
    }

    const substitute = await devices.seal(new Uint8Array(32).fill(13), historical.binding);

    await expect(
      devices.accept(
        recipient.encryption.privateKey,
        expected,
        {
          ...value,
          witness: { kind: 'enrollment', ...body, history: [substitute] },
        },
        pin,
        1,
      ),
    ).rejects.toMatchObject({ code: 'integrity-failure' });

    await expect(devices.accept(recipient.encryption.privateKey, expected, value, pin, 2)).rejects.toMatchObject({
      code: 'context-mismatch',
    });

    await expect(devices.accept(recipient.encryption.privateKey, expected, value, pin, 3)).rejects.toMatchObject({
      code: 'context-mismatch',
    });

    await expect(
      devices.accept(recipient.encryption.privateKey, expected, value, { ...pin, signing: keys.signing }, 1),
    ).rejects.toMatchObject({ code: 'integrity-failure' });
  });
  it('accepts the independently signed public Node approval fixture byte for byte', async () => {
    const value = approvedDeliverySchema.parse(reference.approval);

    expect(deviceActionMessage(value.authorization)).toBe(reference.approvalMessage);
    const privateKey = await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(reference.encryptionPrivatePkcs8, 'base64url'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const raw = await devices.accept(privateKey as unknown as CryptoKey, value.delivery.binding, value, {
      deviceId: value.authorization.deviceId,
      signing: reference.challenge.keys.signing,
    });

    expect(raw).toEqual(new Uint8Array(32).fill(7));
    raw.fill(0);
  });
  it('accepts a delivery only with the separately trusted signing pin and a bound witness', async () => {
    const raw = await devices.accept(recipient.encryption.privateKey, binding, approved, pin);

    expect(raw).toEqual(new Uint8Array(32).fill(7));
    raw.fill(0);
  });
  it('rejects a cloud-created substitute key even though OAEP encryption itself is valid', async () => {
    const substitute = await devices.seal(new Uint8Array(32).fill(13), binding);

    if (approved.witness.kind !== 'enrollment') {
      throw new Error('synthetic_witness_invalid');
    }

    const forged = { ...approved, delivery: substitute, witness: { ...approved.witness, delivery: substitute } };

    await expect(devices.accept(recipient.encryption.privateKey, binding, forged, pin)).rejects.toMatchObject({
      code: 'integrity-failure',
    });
  });
  it('rejects a missing witness, wrong trusted signer, removed signatures and substituted context', async () => {
    await expect(
      devices.accept(recipient.encryption.privateKey, binding, approved.delivery, pin),
    ).rejects.toMatchObject({ code: 'malformed' });

    const keys = await devices.publicKeys(recipient);

    await expect(
      devices.accept(recipient.encryption.privateKey, binding, approved, { ...pin, signing: keys.signing }),
    ).rejects.toMatchObject({ code: 'integrity-failure' });

    await expect(
      devices.accept(
        recipient.encryption.privateKey,
        binding,
        { ...approved, authorization: { ...approved.authorization, signature: '' } },
        pin,
      ),
    ).rejects.toMatchObject({ code: 'malformed' });

    await expect(
      devices.accept(recipient.encryption.privateKey, { ...binding, ownerId: binding.deviceId }, approved, pin),
    ).rejects.toMatchObject({ code: 'context-mismatch' });
  });
  it('requires the returned ciphertext to be the exact signed witness member', async () => {
    const substitute = await devices.seal(new Uint8Array(32).fill(7), binding);

    await expect(
      devices.accept(recipient.encryption.privateKey, binding, { ...approved, delivery: substitute }, pin),
    ).rejects.toMatchObject({ code: 'context-mismatch' });
  });
  it('accepts a complete signed rotation witness and rejects replay into its new generation', async () => {
    const nextBinding = { ...binding, key: { ...binding.key, generation: 2 } };
    const delivery = await devices.seal(new Uint8Array(32).fill(17), nextBinding);
    const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(JSON.stringify({ deliveries: [delivery] })));
    const { signature: _signature, ...previous } = approved.authorization;
    const authorization = await devices.signAction(signer, {
      ...previous,
      action: 'rotate',
      bodyHash: encodeBytes(new Uint8Array(digest)),
    });
    const rotation = approvedDeliverySchema.parse({
      ...approved,
      delivery,
      authorization,
      witness: { kind: 'rotation', deliveries: [delivery] },
    });
    const raw = await devices.accept(recipient.encryption.privateKey, nextBinding, rotation, pin);

    expect(raw).toEqual(new Uint8Array(32).fill(17));
    raw.fill(0);

    await expect(devices.accept(recipient.encryption.privateKey, nextBinding, approved, pin)).rejects.toMatchObject({
      code: 'context-mismatch',
    });
  });
});
