import { argon2Sync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Deliberately public synthetic PIN/secret. Independent Node implementation; never protect real data with this fixture.
const pin = '048261';
const salt = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const parameters = { parallelism: 1, memory: 65536, passes: 3, tagLength: 32 };
const secret = argon2Sync('argon2id', { ...parameters, message: pin, nonce: salt });
const vector = {
  format: 'visomi.pin-vector',
  version: 1,
  method: 'pin-argon2id',
  pin,
  methodId: salt.toString('base64url'),
  parameters,
  secret: secret.toString('base64url'),
};
const path = new URL('../../../../shared/db/fixtures/pin-v1.json', import.meta.url);

if (process.argv.includes('--write')) {
  await writeFile(path, JSON.stringify(vector, null, 2) + '\n');
} else {
  const contents = await readFile(path, 'utf8');
  const existing = JSON.parse(contents);

  if (JSON.stringify(existing) !== JSON.stringify(vector)) {
    throw new Error('pin_vector_mismatch');
  }
}
