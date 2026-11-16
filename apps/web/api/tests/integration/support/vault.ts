import {
  createCipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';

import {
  createOperationId,
  dataAad,
  dataEnvelopeSchema,
  deviceActionMessage,
  deviceChallengeSchema,
  deviceDeliveryLabel,
  deviceProofMessage,
  deviceProofSchema,
  type DataContext,
  type DeviceChallenge,
  type DeviceDelivery,
  type DeviceAction,
  type KeyDomain,
  type SyncHead,
} from '@visomi-stack/shared-persistence';
import { expect } from 'vitest';

import { base, fixture } from './persistence';

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Client = Fixture['owner'];
export const domain = 'private-resources';
export const vaultBase = (target: Fixture['target']) => `${base(target)}/domains/${domain}`;
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
export const identity = () => {
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const encryption = generateKeyPairSync('rsa', { modulusLength: 3072 });

  return {
    signing,
    encryption,
    id: randomUUID(),
    keys: {
      signing: signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      encryption: encryption.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    },
  };
};
export type Identity = ReturnType<typeof identity>;

export async function request(client: Client, target: Fixture['target'], device: Identity) {
  const result = await client.call(`${vaultBase(target)}/devices/request`, 'POST', {
    deviceId: device.id,
    keys: device.keys,
  });

  expect(result.status).toBe(200);

  return prove(device, result.body);
}

export function prove(device: Identity, raw: unknown) {
  const challenge = deviceChallengeSchema.parse(raw);
  const proof = sign('sha256', Buffer.from(deviceProofMessage(challenge)), {
    key: device.signing.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return deviceProofSchema.parse({ ...challenge, proof });
}

export function authorize(
  device: Identity,
  key: KeyDomain,
  epoch: number,
  action: DeviceAction['action'],
  body: unknown,
  operationId: string = randomUUID(),
): DeviceAction {
  const value = { key, deviceId: device.id, epoch, action, operationId, bodyHash: digest(JSON.stringify(body)) };
  const signature = sign('sha256', Buffer.from(deviceActionMessage(value)), {
    key: device.signing.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return { ...value, signature };
}

export function deliver(
  challenge: DeviceChallenge,
  generation = challenge.key.generation,
  raw = Buffer.alloc(32, 7),
): DeviceDelivery {
  const binding = {
    key: { ...challenge.key, generation },
    ownerId: challenge.ownerId,
    deviceId: challenge.deviceId,
    requestId: challenge.requestId,
    challenge: challenge.challenge,
    fingerprint: digest(deviceProofMessage(challenge)),
    encryption: challenge.keys.encryption,
  };
  const ciphertext = publicEncrypt(
    {
      key: createPublicKey({ key: Buffer.from(challenge.keys.encryption, 'base64url'), format: 'der', type: 'spki' }),
      oaepHash: 'sha256',
      oaepLabel: Buffer.from(deviceDeliveryLabel(binding)),
    },
    raw,
  ).toString('base64url');

  return { format: 'visomi.device-key', version: 1, algorithm: 'RSA-OAEP-3072-SHA-256', binding, ciphertext };
}

export async function boot(f: Fixture, device: Identity) {
  const proof = await request(f.owner, f.target, device);
  const result = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', proof);

  expect(result.status).toBe(200);

  return proof;
}

export function push(
  device: Identity,
  challenge: DeviceChallenge,
  head: SyncHead = { cursor: 0, checkpoint: null },
  epoch = 1,
  revision = 1,
  id: string = randomUUID(),
  kind: DataContext['kind'] = 'record',
  generation = challenge.key.generation,
  plaintext?: Buffer,
  rawDataKey = Buffer.alloc(32, 7),
) {
  const context: DataContext = {
    key: { ...challenge.key, generation },
    target: challenge.key.scope,
    objectId: id,
    schemaVersion: 1,
    revision,
    kind,
    previousCheckpoint: head.checkpoint,
  };
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', rawDataKey, nonce);

  cipher.setAAD(Buffer.from(dataAad(context)));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext ?? (kind === 'tombstone' ? Buffer.alloc(0) : Buffer.from('Synthetic secret payload'))),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64url');
  const envelope = dataEnvelopeSchema.parse({
    format: 'visomi.data',
    version: 1,
    algorithm: 'A256GCM',
    context,
    nonce: nonce.toString('base64url'),
    ciphertext,
  });
  const operationId = createOperationId(globalThis.crypto);
  const body = { protocol: 1 as const, operationId, expectedRevision: revision - 1, head, envelope };

  return { ...body, authorization: authorize(device, context.key, epoch, 'sync', body, operationId) };
}
