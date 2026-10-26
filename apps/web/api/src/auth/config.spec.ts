import { describe, expect, it } from 'vitest';

import { authConfig } from './config';

const secret = 'synthetic-session-key-32-bytes-minimum';

describe('trusted authentication configuration', () => {
  it('permits insecure cookies only on explicit loopback development origins', () => {
    expect(authConfig({ origin: 'http://localhost:3307', rpId: 'localhost', secret })).toMatchObject({
      secure: false,
      cookieName: 'visomi.sid',
    });
    expect(authConfig({ origin: 'https://app.example.test', rpId: 'example.test', secret })).toMatchObject({
      secure: true,
      cookieName: '__Host-visomi.sid',
    });
  });

  it.each([
    { origin: 'http://example.test', rpId: 'example.test' },
    { origin: 'https://app.example.test/path', rpId: 'example.test' },
    { origin: 'https://app.example.test', rpId: 'other.test' },
    { origin: 'https://app.example.test', rpId: 'test' },
    { origin: 'invalid', rpId: 'localhost' },
  ])('rejects an unsafe origin or RP configuration %j', (input) => {
    expect(() => authConfig({ ...input, secret })).toThrow('auth_configuration_invalid');
  });

  it('rejects missing and weak session secrets without including the secret in errors', () => {
    expect(() => authConfig({ origin: 'http://localhost', rpId: 'localhost', secret: 'short' })).toThrow(
      'auth_configuration_invalid',
    );
  });
});
