import {
  generateKeyPairSync,
  sign,
  verify,
  publicEncrypt,
  privateDecrypt,
  createHash,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../../../../shared/db/fixtures/devices-v1.json', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('../../../../shared/db/fixtures/crypto-v1.json', import.meta.url)));
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

// Independent Node framing for explicit historical grants; no production contract implementation is imported.
const historyPath = new URL('../../../../shared/db/fixtures/devices-history-v1.json', import.meta.url);
const keyFields = (key) => [
  key.product,
  key.domain,
  [key.scope.kind, key.scope.tenantId, key.scope.groupId, key.scope.resourceId],
  key.generation,
];
const enrollmentMessage = (challenge) =>
  JSON.stringify([
    'visomi.device-enrollment',
    1,
    ...keyFields(challenge.key),
    challenge.ownerId,
    challenge.deviceId,
    challenge.requestId,
    challenge.challenge,
    challenge.expiresAt,
    challenge.keys.signing,
    challenge.keys.encryption,
  ]);
const deliveryLabel = (binding) =>
  JSON.stringify([
    'visomi.device-key',
    1,
    'RSA-OAEP-3072-SHA-256',
    ...keyFields(binding.key),
    binding.ownerId,
    binding.deviceId,
    binding.requestId,
    binding.challenge,
    binding.fingerprint,
    binding.encryption,
  ]);
const actionMessage = (action) =>
  JSON.stringify([
    'visomi.device-action',
    1,
    ...keyFields(action.key),
    action.deviceId,
    action.operationId,
    action.epoch,
    action.action,
    action.bodyHash,
  ]);

if (process.argv.includes('--history') || process.argv.includes('--generate')) {
  const challenge = {
    ...fixture.challenge,
    key: { ...fixture.challenge.key, generation: 2 },
    requestId: '88888888-8888-4888-8888-888888888888',
  };
  const message = enrollmentMessage(challenge);
  const privateKey = createPrivateKey({
    key: Buffer.from(fixture.signingPrivatePkcs8, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const proof = {
    ...challenge,
    proof: sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
  const binding = {
    key: challenge.key,
    ownerId: challenge.ownerId,
    deviceId: challenge.deviceId,
    requestId: challenge.requestId,
    challenge: challenge.challenge,
    fingerprint: createHash('sha256').update(message).digest('base64url'),
    encryption: challenge.keys.encryption,
  };
  const seal = (generation, raw) => {
    const recipient = { ...binding, key: { ...binding.key, generation } };
    const publicKey = createPublicKey({
      key: Buffer.from(recipient.encryption, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    const ciphertext = publicEncrypt(
      { key: publicKey, oaepHash: 'sha256', oaepLabel: Buffer.from(deliveryLabel(recipient)) },
      raw,
    ).toString('base64url');

    return {
      format: 'visomi.device-key',
      version: 1,
      algorithm: 'RSA-OAEP-3072-SHA-256',
      binding: recipient,
      ciphertext,
    };
  };
  const currentRaw = Buffer.alloc(32, 23);
  const delivery = seal(2, currentRaw);
  const history = [seal(1, rawKey)];
  const body = { proof, delivery, history };
  const action = {
    key: challenge.key,
    deviceId: fixture.approval.authorization.deviceId,
    operationId: challenge.requestId,
    epoch: 2,
    action: 'approve',
    bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('base64url'),
  };
  const approvalMessage = actionMessage(action);
  const signature = sign('sha256', Buffer.from(approvalMessage), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  writeFileSync(
    historyPath,
    JSON.stringify(
      {
        status: fixture.status,
        keysFixture: 'devices-v1.json',
        message,
        approvalMessage,
        currentLabel: deliveryLabel(delivery.binding),
        historicalLabel: deliveryLabel(history[0].binding),
        currentDataKeyHex: currentRaw.toString('hex'),
        historicalDataKeyHex: rawKey.toString('hex'),
        approval: {
          format: 'visomi.approved-device-key',
          version: 1,
          delivery,
          authorization: { ...action, signature },
          witness: { kind: 'enrollment', ...body },
        },
      },
      null,
      2,
    ) + '\n',
  );
}

const historical = JSON.parse(readFileSync(historyPath));
const approval = historical.approval;
const witness = approval.witness;
const body = { proof: witness.proof, delivery: witness.delivery, history: witness.history };

if (
  historical.message !== enrollmentMessage(witness.proof) ||
  historical.approvalMessage !== actionMessage(approval.authorization) ||
  approval.authorization.bodyHash !== createHash('sha256').update(JSON.stringify(body)).digest('base64url') ||
  !verify('sha256', Buffer.from(historical.message), signingKey, Buffer.from(witness.proof.proof, 'base64url')) ||
  !verify(
    'sha256',
    Buffer.from(historical.approvalMessage),
    signingKey,
    Buffer.from(approval.authorization.signature, 'base64url'),
  )
) {
  throw new Error('Synthetic historical approval fixture invalid');
}

for (const [delivery, label, hex] of [
  [approval.delivery, historical.currentLabel, historical.currentDataKeyHex],
  [witness.history[0], historical.historicalLabel, historical.historicalDataKeyHex],
]) {
  if (
    label !== deliveryLabel(delivery.binding) ||
    !privateDecrypt(
      { ...encryptionKey, oaepLabel: Buffer.from(label) },
      Buffer.from(delivery.ciphertext, 'base64url'),
    ).equals(Buffer.from(hex, 'hex'))
  ) {
    throw new Error('Synthetic historical delivery fixture invalid');
  }
}
