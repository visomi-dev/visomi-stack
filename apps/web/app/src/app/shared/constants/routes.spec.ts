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
  ])('rejects unsafe or unsupported destination %s', (value) => {
    expect(authDestination(value)).toBe('/');
  });
});
