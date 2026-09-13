import { randomBytes, timingSafeEqual } from 'node:crypto';

import { argon2id } from 'hash-wasm';

import { env } from '../shared/env';

import { verifySecret } from './auth-crypto';

import { HttpError } from 'shared';

/**
 * Password authentication is intentionally fail-closed until the approved
 * Argon2id implementation and TOTP key configuration are deployed.
 */
export function assertPasswordAuthenticationAvailable(): void {
  if (!env.AUTH_PASSWORD_ENABLED) {
    throw new HttpError({
      code: 'password_auth_disabled',
      message: 'Password sign-in is not enabled.',
      statusCode: 404,
    });
  }
}

export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

export function passwordLength(password: string): number {
  return Array.from(normalizePassword(password)).length;
}

export function validatePasswordPolicy(password: string): boolean {
  const length = passwordLength(password);

  return length >= 15 && length <= 128;
}

const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = cryptoRandomBytes(16);
  const hash = await argon2id({
    password: normalizePassword(password),
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: 32,
    outputType: 'hex',
  });

  return `$argon2id$v=19$m=${ARGON2_MEMORY_KIB},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}$${Buffer.from(salt).toString('base64')}$${Buffer.from(hash, 'hex').toString('base64')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith('$argon2id$')) return verifyLegacyPassword(password, storedHash);
  const parts = storedHash.split('$');
  const parameters = parts[3]?.split(',').map((part) => part.split('=')) ?? [];
  const values = new Map(parameters as Array<[string, string]>);
  const salt = parts[4];
  const expected = parts[5];

  if (
    !salt ||
    !expected ||
    values.get('m') !== String(ARGON2_MEMORY_KIB) ||
    values.get('t') !== String(ARGON2_ITERATIONS) ||
    values.get('p') !== String(ARGON2_PARALLELISM)
  )
    return false;
  const actual = await argon2id({
    password: normalizePassword(password),
    salt: Buffer.from(salt, 'base64'),
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: 32,
    outputType: 'hex',
  });

  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer =
    /^[0-9a-f]+$/i.test(expected) && expected.length === 64
      ? Buffer.from(expected, 'hex')
      : Buffer.from(expected, 'base64');

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function verifyLegacyPassword(password: string, storedHash: string): Promise<boolean> {
  return verifySecret(normalizePassword(password), storedHash);
}

function cryptoRandomBytes(length: number): Uint8Array {
  return randomBytes(length);
}
