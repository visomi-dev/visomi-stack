import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { argon2id } from 'hash-wasm';
import { generateSecret, generateURI, verify } from 'otplib';
import { HttpError } from '@visomi-stack/web-backend-shared';

export const pin = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const token = () => randomBytes(16).toString('hex').toUpperCase();
export const digest = (secret: string, context: string, value: string) =>
  createHmac('sha256', secret).update(context).update('\0').update(value).digest('hex');
export function matches(actual: string, expected: string) {
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'email_invalid');
  }

  const email = value.trim().toLowerCase();

  if (
    email.length > 254 ||
    Array.from(email).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  ) {
    throw new HttpError(400, 'email_invalid');
  }

  return email;
}
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
export function encryptSecret(secret: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);

  cipher.setAAD(Buffer.from('visomi.auth.totp.v1'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  return [
    '1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function decryptSecret(value: string, key: string) {
  const [version, iv, tag, encrypted] = value.split('.');

  if (version !== '1' || !iv || !tag || !encrypted) {
    throw new Error('totp_secret_invalid');
  }

  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(iv, 'base64url'));

  cipher.setAAD(Buffer.from('visomi.auth.totp.v1'));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8');
}
export async function totpStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) {
    return -1;
  }

  const current = Math.floor(now / 30_000);

  for (const offset of [0, -1, 1]) {
    const result = await verify({ secret, token: code, epoch: (current + offset) * 30, epochTolerance: 0 });

    if (result.valid) {
      return current + offset;
    }
  }

  return -1;
}
export function totpSetup(email: string) {
  const secret = generateSecret();

  return { secret, uri: generateURI({ issuer: 'Visomi Stack', label: email, secret }) };
}
