import { expect, it } from 'vitest';

import { normalizeEmail } from '../email/normalization';

it.each([null, 'invalid', 'a@b', 'a\u0001@b.test', 'a\u007f@b.test', `${'a'.repeat(255)}@b.test`])(
  'rejects malformed email %s',
  (value) => {
    expect(() => normalizeEmail(value)).toThrow('email_invalid');
  },
);
it('normalizes email without folding provider-specific aliases', () => {
  expect(normalizeEmail(' Name+Alias@Example.Test ')).toBe('name+alias@example.test');
});
