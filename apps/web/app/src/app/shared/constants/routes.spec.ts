import { authDestination } from './routes';

describe('authDestination', () => {
  it.each(['/dashboard', '/security', '/gallery', '/activation'])('preserves the internal destination %s', (value) => {
    expect(authDestination(value)).toBe(value);
  });

  it.each([
    null,
    'https://example.test',
    '//example.test',
    '/\\example.test',
    '/auth/sign-in',
    '/%2fexample.test',
    '/security?returnTo=https://example.test',
    '/security/device-approval?requestId=invalid',
    '/security/device-approval?requestId=12345678-1234-4234-8234-123456789abc&returnTo=https://example.test',
  ])('rejects unsafe or unsupported destination %s', (value) => {
    expect(authDestination(value)).toBe('/');
  });
  it('preserves only the validated approval reference through authentication', () => {
    const path = '/security/device-approval?requestId=12345678-1234-4234-8234-123456789abc';

    expect(authDestination(path)).toBe(path);
  });
});
