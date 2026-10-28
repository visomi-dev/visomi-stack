import { randomBytes } from 'node:crypto';

import { HttpError } from '@visomi-stack/web-backend-shared';
import { argon2id } from 'hash-wasm';

import { matches } from '../shared/secrets';

export function passwordInput(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'password_invalid');
  }

  const normalized = value.normalize('NFC');

  if (Array.from(normalized).length < 12 || Array.from(normalized).length > 128) {
    throw new HttpError(400, 'password_policy');
  }

  return normalized;
}

const parameters = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: 'hex' as const };

let derivations = 0;

async function derivePassword(password: string, salt: Buffer) {
  // Bound per-process Argon2 memory even when distributed request limits allow a burst.
  if (derivations >= 4) {
    throw new HttpError(429, 'password_capacity');
  }

  derivations++;

  try {
    const hash = await argon2id({ ...parameters, password, salt });

    return hash;
  } finally {
    derivations--;
  }
}

export async function hashPassword(value: string) {
  const salt = randomBytes(16);
  const hash = await derivePassword(passwordInput(value), salt);

  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64')}$${Buffer.from(hash, 'hex').toString('base64')}`;
}

export async function verifyPassword(value: string, hash: string) {
  const parts = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/.exec(hash);
  // A fixed synthetic salt/hash keeps unknown-user attempts on the same expensive path.
  const salt = parts ? Buffer.from(parts[1], 'base64') : Buffer.alloc(16);
  const actual = await derivePassword(value.normalize('NFC'), salt);

  return Boolean(parts && matches(actual, Buffer.from(parts[2], 'base64').toString('hex')));
}
