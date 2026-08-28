import { createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { env } from '../shared/env';

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 32;

export async function hashSecret(secret: string) {
  const salt = randomBytes(16).toString('hex');

  const derivedKey = (await scrypt(secret, salt, KEY_LENGTH)) as Buffer;

  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifySecret(secret: string, storedHash: string) {
  const [salt, hash] = storedHash.split(':');

  if (!salt || !hash) {
    return false;
  }

  const derivedKey = (await scrypt(secret, salt, KEY_LENGTH)) as Buffer;

  const storedBuffer = Buffer.from(hash, 'hex');

  if (storedBuffer.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, derivedKey);
}

export function hashUserDeviceToken(token: string) {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export function verifyUserDeviceToken(token: string, storedHash: string) {
  const expected = Buffer.from(hashUserDeviceToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  if (expected.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(expected, stored);
}

export function generateVerificationPin() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateUserDeviceToken() {
  return randomBytes(32).toString('base64url');
}
