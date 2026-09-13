import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { generateSecret, verify } from 'otplib';

import { env } from '../shared/env';

const KEY_VERSION = 1;
const PERIOD_SECONDS = 30;

function key(): Buffer {
  return scryptSync(env.AUTH_TOTP_ENCRYPTION_KEY || env.SESSION_SECRET, 'themis-totp-secret-v1', 32);
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  const encode = (part: Buffer): string => part.toString('base64url');

  return [String(KEY_VERSION), encode(iv), encode(cipher.getAuthTag()), encode(ciphertext)].join('.');
}

export function decryptTotpSecret(value: string, keyVersion: number): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.');

  if (Number(version) !== KEY_VERSION || keyVersion !== KEY_VERSION || !encodedIv || !encodedTag || !encodedCiphertext)
    throw new Error('Unsupported TOTP secret version.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(encodedIv, 'base64url'));

  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));

  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  return verify({ secret, token: code, epochTolerance: 1 }).then((result) => result.valid);
}

export function totpTimeStep(now = Date.now()): number {
  return Math.floor(now / 1000 / PERIOD_SECONDS);
}

export { KEY_VERSION as TOTP_KEY_VERSION };
