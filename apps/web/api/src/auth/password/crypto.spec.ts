import { expect, it } from 'vitest';

import { hashPassword, passwordInput, verifyPassword } from '../password/crypto';
import { digest, matches, pin, token } from '../shared/secrets';

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
