import {
  assertPasswordAuthenticationAvailable,
  hashPassword,
  normalizePassword,
  passwordLength,
  validatePasswordPolicy,
  verifyPassword,
} from './password';

import { HttpError } from 'shared';

describe('password authentication foundation', () => {
  it('normalizes passwords with NFC without trimming or collapsing spaces', () => {
    expect(normalizePassword(' cafe\u0301  password ')).toBe(' café  password ');
  });

  it('counts Unicode code points and enforces the configured length bounds', () => {
    expect(passwordLength('12345678901234')).toBe(14);
    expect(validatePasswordPolicy('123456789012345')).toBe(true);
    expect(validatePasswordPolicy('😀'.repeat(15))).toBe(true);
    expect(validatePasswordPolicy('x'.repeat(129))).toBe(false);
  });

  it('fails closed because Argon2id and factor configuration are not present', () => {
    expect(() => assertPasswordAuthenticationAvailable()).toThrow(HttpError);
  });

  it('uses PHC Argon2id hashes and rejects a wrong password', async () => {
    const hash = await hashPassword('a secure password');

    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    await expect(verifyPassword('a secure password', hash)).resolves.toBe(true);
    await expect(verifyPassword('a different password', hash)).resolves.toBe(false);
  });
});
