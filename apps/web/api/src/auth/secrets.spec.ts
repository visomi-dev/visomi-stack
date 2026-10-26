import { describe, expect, it } from 'vitest';
import { generate } from 'otplib';

import { authConfig } from './config';
import {
  decryptSecret,
  digest,
  encryptSecret,
  hashPassword,
  matches,
  normalizeEmail,
  passwordInput,
  pin,
  token,
  totpSetup,
  totpStep,
  verifyPassword,
} from './secrets';

const key = Buffer.alloc(32, 7).toString('base64url');

describe('authentication secret boundaries', () => {
  it.each([null, 'invalid', 'a@b', 'a\u0001@b.test', 'a\u007f@b.test', `${'a'.repeat(255)}@b.test`])(
    'rejects malformed email %s',
    (value) => {
      expect(() => normalizeEmail(value)).toThrow('email_invalid');
    },
  );
  it('normalizes email without folding provider-specific aliases', () => {
    expect(normalizeEmail(' Name+Alias@Example.Test ')).toBe('name+alias@example.test');
  });
  it.each([null, 'short', 'x'.repeat(129)])('rejects invalid password policy %s', (value) => {
    expect(() => passwordInput(value)).toThrow();
  });
  it('hashes normalized passwords, handles malformed hashes and compares safely', async () => {
    const password = 'Synthetic e\u0301 password!';
    const hash = await hashPassword(password);
    const result1 = await verifyPassword(password.normalize('NFC'), hash);

    expect(result1).toBe(true);
    const result2 = await verifyPassword('different', hash);

    expect(result2).toBe(false);
    const result3 = await verifyPassword('anything', 'malformed');

    expect(result3).toBe(false);
    expect(matches('a', 'long')).toBe(false);
    expect(matches('aaa', 'bbb')).toBe(false);
    expect(pin()).toMatch(/^\d{6}$/);
    expect(token()).toMatch(/^[A-F0-9]{32}$/);
    expect(digest('secret', 'a', 'value')).not.toBe(digest('secret', 'b', 'value'));
  });
  it('authenticates encrypted TOTP secrets and validates adjacent windows', async () => {
    const setup = totpSetup('synthetic@example.test');
    const encrypted = encryptSecret(setup.secret, key);

    expect(decryptSecret(encrypted, key)).toBe(setup.secret);
    expect(setup.uri).toContain('otpauth://');
    expect(() => decryptSecret('2.invalid', key)).toThrow('totp_secret_invalid');
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8).toString('base64url'))).toThrow();
    const now = Date.now();

    const validCodes: string[] = [];

    for (const offset of [-1, 0, 1]) {
      const code = await generate({ secret: setup.secret, epoch: Math.floor(now / 30000) * 30 + offset * 30 });

      validCodes.push(code);
      const result4 = await totpStep(setup.secret, code, now);

      expect(result4).toBe(Math.floor(now / 30000) + offset);
    }
    const invalidCode = ['000000', '000001', '000002', '000003'].find((value) => !validCodes.includes(value))!;
    const noWindow = await totpStep(setup.secret, invalidCode, now);

    expect(noWindow).toBe(-1);
    const result5 = await totpStep(setup.secret, 'invalid', now);

    expect(result5).toBe(-1);
  });
  it('validates dedicated TOTP configuration', () => {
    const input = {
      origin: 'http://localhost',
      rpId: 'localhost',
      secret: 'synthetic-secret-more-than-thirty-two-bytes',
    };

    expect(authConfig({ ...input, totpKey: key }).totpKey).toBe(key);
    expect(() => authConfig({ ...input, totpKey: 'invalid' })).toThrow('auth_configuration_invalid');
  });
});
