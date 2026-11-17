import { createCipheriv, hkdfSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Independent public synthetic reference: no import from the implementation under test.
const key = Buffer.alloc(32, 7);
const secret = Buffer.alloc(32, 9);
const salt = Buffer.alloc(32, 3);
const nonce = Buffer.alloc(12, 5);
const scope = {
  kind: 'resource',
  tenantId: '11111111-1111-4111-8111-111111111111',
  groupId: null,
  resourceId: '22222222-2222-4222-8222-222222222222',
};
const domain = { product: 'synthetic-example', domain: 'private-resources', scope, generation: 1 };
const context = {
  key: domain,
  target: scope,
  objectId: '33333333-3333-4333-8333-333333333333',
  schemaVersion: 1,
  revision: 1,
  kind: 'record',
  previousCheckpoint: null,
};
const wrapping = {
  key: domain,
  ownerId: '44444444-4444-4444-8444-444444444444',
  deviceId: '55555555-5555-4555-8555-555555555555',
  method: 'passkey-prf',
  methodId: 'AQ',
  origin: 'https://synthetic.example.test',
};
const scopeBytes = ['resource', scope.tenantId, null, scope.resourceId];
const aad = JSON.stringify([
  'visomi.data',
  1,
  'A256GCM',
  domain.product,
  domain.domain,
  scopeBytes,
  scopeBytes,
  1,
  context.objectId,
  1,
  1,
  'record',
  null,
]);
const wrapAad = JSON.stringify([
  'visomi.wrap',
  1,
  'A256GCM',
  'HKDF-SHA-256',
  domain.product,
  domain.domain,
  scopeBytes,
  1,
  wrapping.ownerId,
  wrapping.deviceId,
  'passkey-prf',
  'AQ',
  wrapping.origin,
]);
const wrappingKey = Buffer.from(hkdfSync('sha256', secret, salt, Buffer.from(wrapAad), 32));
const plaintext = Buffer.from('Synthetic public vector ☃', 'utf8');

function encrypt(keyBytes, aadText, value) {
  const cipher = createCipheriv('aes-256-gcm', keyBytes, nonce);

  cipher.setAAD(Buffer.from(aadText, 'utf8'));

  return Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}

const fixture = {
  status: 'synthetic-reference-not-security-approval',
  reference: 'Node crypto createCipheriv and hkdfSync; native clients not yet executed',
  dataKeyHex: key.toString('hex'),
  secretHex: secret.toString('hex'),
  plaintextHex: plaintext.toString('hex'),
  dataAad: aad,
  wrappingAad: wrapAad,
  derivedWrappingKeyHex: wrappingKey.toString('hex'),
  data: {
    format: 'visomi.data',
    version: 1,
    algorithm: 'A256GCM',
    context,
    nonce: nonce.toString('base64url'),
    ciphertext: encrypt(key, aad, plaintext),
  },
  wrapped: {
    format: 'visomi.wrap',
    version: 1,
    algorithm: 'A256GCM',
    kdf: 'HKDF-SHA-256',
    context: wrapping,
    salt: salt.toString('base64url'),
    nonce: nonce.toString('base64url'),
    ciphertext: encrypt(wrappingKey, wrapAad, key),
  },
};
const path = new URL('../../../../shared/db/fixtures/crypto-v1.json', import.meta.url);
const serialized = JSON.stringify(fixture, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = await readFile(path, 'utf8');

  if (current !== serialized) {
    throw new Error('crypto_vectors_changed');
  }
} else {
  await writeFile(path, serialized);
}
