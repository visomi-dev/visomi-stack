import { generate } from 'otplib';
import { expect, it } from 'vitest';

import { authConfig } from '../shared/config';
import { decryptSecret, encryptSecret, totpSetup, totpStep } from '../totp/secrets';

const key = Buffer.alloc(32, 7).toString('base64url');

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
