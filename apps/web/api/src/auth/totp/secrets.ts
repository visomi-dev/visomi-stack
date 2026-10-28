import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { generateSecret, generateURI, verify } from 'otplib';

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
