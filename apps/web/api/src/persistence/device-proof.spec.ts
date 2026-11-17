import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';

import { deviceProofSchema, deviceActionMessage, type DeviceAction } from '@visomi-stack/shared-persistence';
import { describe, expect, it } from 'vitest';

import { publicHash, verifyDeviceAction, verifyDeviceProof } from './device-proof';

const fixture = JSON.parse(
  readFileSync(new URL('../../../../../libs/shared/persistence/fixtures/devices-v1.json', import.meta.url), 'utf8'),
);
const proof = deviceProofSchema.parse({ ...fixture.challenge, proof: fixture.proof });

describe('server device proof verification', () => {
  it('rejects an invalid signature, malformed SPKI and unexpected key profiles with controlled errors', () => {
    expect(() => verifyDeviceProof(proof)).not.toThrow();
    expect(() => verifyDeviceProof({ ...proof, proof: Buffer.alloc(64).toString('base64url') })).toThrow(
      'device_proof_invalid',
    );
    expect(() =>
      verifyDeviceProof({ ...proof, keys: { ...proof.keys, signing: Buffer.alloc(91).toString('base64url') } }),
    ).toThrow('device_proof_invalid');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const ec = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const exportKey = (key: typeof rsa.publicKey) => key.export({ type: 'spki', format: 'der' }).toString('base64url');

    expect(() => verifyDeviceProof({ ...proof, keys: { ...proof.keys, signing: exportKey(rsa.publicKey) } })).toThrow(
      'device_proof_invalid',
    );
    expect(() => verifyDeviceProof({ ...proof, keys: { ...proof.keys, signing: exportKey(ec.publicKey) } })).toThrow(
      'device_proof_invalid',
    );
    expect(() =>
      verifyDeviceProof({ ...proof, keys: { ...proof.keys, encryption: exportKey(rsa.publicKey) } }),
    ).toThrow('device_proof_invalid');
    expect(() => verifyDeviceProof({ ...proof, keys: { ...proof.keys, encryption: exportKey(ec.publicKey) } })).toThrow(
      'device_proof_invalid',
    );
    const exponent = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 3 });

    expect(() =>
      verifyDeviceProof({ ...proof, keys: { ...proof.keys, encryption: exportKey(exponent.publicKey) } }),
    ).toThrow('device_proof_invalid');
  });
  it('binds action signatures to the normalized body as well as the device key', () => {
    const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const signing = device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    const body = { deviceId: proof.deviceId };
    const value = {
      key: proof.key,
      deviceId: proof.deviceId,
      operationId: proof.requestId,
      epoch: 1,
      action: 'revoke' as const,
      bodyHash: publicHash(JSON.stringify(body)),
    };
    const signature = sign('sha256', Buffer.from(deviceActionMessage(value)), {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const action: DeviceAction = { ...value, signature };

    expect(() => verifyDeviceAction(signing, action, body)).not.toThrow();
    expect(() => verifyDeviceAction(signing, { ...action, bodyHash: publicHash('changed') }, body)).toThrow(
      'device_proof_invalid',
    );
    expect(() =>
      verifyDeviceAction(signing, { ...action, signature: Buffer.alloc(64).toString('base64url') }, body),
    ).toThrow('device_proof_invalid');
  });
});
