import {
  generateKeyPairSync,
  sign,
  verify,
  publicEncrypt,
  privateDecrypt,
  createHash,
  createPrivateKey,
} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../../../../shared/persistence/fixtures/devices-v1.json', import.meta.url);
const reference = JSON.parse(
  readFileSync(new URL('../../../../shared/persistence/fixtures/crypto-v1.json', import.meta.url)),
);
const rawKey = Buffer.from(reference.dataKeyHex, 'hex');

if (process.argv.includes('--generate')) {
  // Deliberately public test-only private keys. Never import these outside synthetic interoperability tests.
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const encryption = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65537 });
  const challenge = {
    format: 'visomi.device-enrollment',
    version: 1,
    key: reference.data.context.key,
    ownerId: reference.wrapped.context.ownerId,
    deviceId: reference.wrapped.context.deviceId,
    requestId: '66666666-6666-4666-8666-666666666666',
    challenge: Buffer.alloc(32, 11).toString('base64url'),
    expiresAt: '2030-01-01T00:00:00.000Z',
    keys: {
      signing: signing.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      encryption: encryption.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    },
  };
  const scope = challenge.key.scope;
  const keyFields = [
    challenge.key.product,
    challenge.key.domain,
    [scope.kind, scope.tenantId, scope.groupId, scope.resourceId],
    challenge.key.generation,
  ];
  const message = JSON.stringify([
    'visomi.device-enrollment',
    1,
    ...keyFields,
    challenge.ownerId,
    challenge.deviceId,
    challenge.requestId,
    challenge.challenge,
    challenge.expiresAt,
    challenge.keys.signing,
    challenge.keys.encryption,
  ]);
  const proof = sign('sha256', Buffer.from(message), { key: signing.privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
  const binding = {
    key: challenge.key,
    ownerId: challenge.ownerId,
    deviceId: challenge.deviceId,
    requestId: challenge.requestId,
    challenge: challenge.challenge,
    fingerprint: createHash('sha256').update(message).digest('base64url'),
    encryption: challenge.keys.encryption,
  };
  const label = JSON.stringify([
    'visomi.device-key',
    1,
    'RSA-OAEP-3072-SHA-256',
    ...keyFields,
    binding.ownerId,
    binding.deviceId,
    binding.requestId,
    binding.challenge,
    binding.fingerprint,
    binding.encryption,
  ]);
  const ciphertext = publicEncrypt(
    { key: encryption.publicKey, oaepHash: 'sha256', oaepLabel: Buffer.from(label) },
    rawKey,
  ).toString('base64url');

  writeFileSync(
    path,
    JSON.stringify(
      {
        status: 'PUBLIC-SYNTHETIC-PRIVATE-KEYS-NEVER-USE-IN-PRODUCTION',
        message,
        label,
        challenge,
        proof,
        delivery: { format: 'visomi.device-key', version: 1, algorithm: 'RSA-OAEP-3072-SHA-256', binding, ciphertext },
        signingPrivatePkcs8: signing.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
        encryptionPrivatePkcs8: encryption.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
      },
      null,
      2,
    ) + '\n',
  );
}

const fixture = JSON.parse(readFileSync(path));

if (process.argv.includes('--approval') || process.argv.includes('--generate')) {
  const proof = { ...fixture.challenge, proof: fixture.proof };
  const bodyHash = createHash('sha256')
    .update(JSON.stringify({ proof, delivery: fixture.delivery }))
    .digest('base64url');
  const challenge = fixture.challenge;
  const scope = challenge.key.scope;
  const action = {
    key: challenge.key,
    deviceId: '77777777-7777-4777-8777-777777777777',
    operationId: challenge.requestId,
    epoch: 1,
    action: 'approve',
    bodyHash,
  };
  const message = JSON.stringify([
    'visomi.device-action',
    1,
    challenge.key.product,
    challenge.key.domain,
    [scope.kind, scope.tenantId, scope.groupId, scope.resourceId],
    challenge.key.generation,
    action.deviceId,
    action.operationId,
    action.epoch,
    action.action,
    action.bodyHash,
  ]);
  const key = createPrivateKey({
    key: Buffer.from(fixture.signingPrivatePkcs8, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');

  fixture.approvalMessage = message;
  fixture.approval = {
    format: 'visomi.approved-device-key',
    version: 1,
    delivery: fixture.delivery,
    authorization: { ...action, signature },
    witness: { kind: 'enrollment', proof, delivery: fixture.delivery },
  };
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
}

const signingKey = {
  key: Buffer.from(fixture.challenge.keys.signing, 'base64url'),
  format: 'der',
  type: 'spki',
  dsaEncoding: 'ieee-p1363',
};

if (!verify('sha256', Buffer.from(fixture.message), signingKey, Buffer.from(fixture.proof, 'base64url'))) {
  throw new Error('Synthetic signature fixture invalid');
}

const encryptionKey = {
  key: Buffer.from(fixture.encryptionPrivatePkcs8, 'base64url'),
  format: 'der',
  type: 'pkcs8',
  oaepHash: 'sha256',
  oaepLabel: Buffer.from(fixture.label),
};

if (
  !verify(
    'sha256',
    Buffer.from(fixture.approvalMessage),
    signingKey,
    Buffer.from(fixture.approval.authorization.signature, 'base64url'),
  )
) {
  throw new Error('Synthetic approval fixture invalid');
}

if (!privateDecrypt(encryptionKey, Buffer.from(fixture.delivery.ciphertext, 'base64url')).equals(rawKey)) {
  throw new Error('Synthetic delivery fixture invalid');
}
