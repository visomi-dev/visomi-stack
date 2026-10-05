import { englishMailCopy, spanishMailCopy } from './generated/email-resources';
import { normalizeMailLocale, renderMail } from './render-mail';
import type { MailMessage } from './render-mail';

const examples: MailMessage[] = [
  { template: 'verification', code: '029471', expiresAt: '2026-10-03T12:00:00Z' },
  { template: 'recovery-notice', appBaseUrl: 'https://app.example/app' },
  { template: 'email-change-notice', appBaseUrl: 'https://app.example/app' },
];

test.each(['en', 'es'] as const)('renders every operational message with HTML and plain text in %s', (locale) => {
  for (const example of examples) {
    const body = renderMail(example, 'Example App', locale);

    expect(body.subject).toContain('Example App');
    expect(body.html).toContain(`lang="${locale}"`);
    expect(body.html).toMatch(/<h1\b/);
    expect(body.html).not.toContain('{{');
    expect(body.html).not.toMatch(/<img|fonts\.googleapis|nive|financial|family-invitation/i);
    expect(body.text).toContain('Example App');
    expect(body.text).not.toContain('<html');
    if (example.template === 'verification') {
      expect(body.text).toContain('029471');
      expect(body.text).toContain('UTC');
    } else {
      expect(body.text).toContain(`https://app.example/app/${locale}/`);
    }
  }
});

test('normalizes locale preferences with an explicit English fallback', () => {
  expect(normalizeMailLocale('es-MX')).toBe('es');
  expect(normalizeMailLocale('ES')).toBe('es');
  expect(normalizeMailLocale('est')).toBe('en');
  expect(normalizeMailLocale('fr')).toBe('en');
  expect(normalizeMailLocale()).toBe('en');
});

test('keeps both catalogs structurally equivalent', () => {
  expect(Object.keys(spanishMailCopy).sort()).toEqual(Object.keys(englishMailCopy).sort());
  for (const template of ['verification', 'recovery-notice', 'email-change-notice'] as const) {
    expect(Object.keys(spanishMailCopy[template]).sort()).toEqual(Object.keys(englishMailCopy[template]).sort());
  }
});

test('escapes the configurable brand in HTML and rejects header injection', () => {
  const body = renderMail(examples[0], '<img src=x onerror=alert(1)> & Test');

  expect(body.html).toContain('&lt;img');
  expect(body.html).not.toContain('<img');
  expect(body.text).toContain('<img src=x onerror=alert(1)> & Test');
  expect(() => renderMail(examples[0], 'Brand\r\nBcc: attacker@example.test')).toThrow('Invalid mail application name');
});

test('validates codes, expiry and notice URLs', () => {
  expect(() =>
    renderMail({ template: 'verification', code: '<script>', expiresAt: '2026-10-03T12:00:00Z' }, 'App'),
  ).toThrow('Invalid mail verification code');
  expect(() => renderMail({ template: 'verification', code: '123456', expiresAt: 'invalid' }, 'App')).toThrow(
    'Invalid mail expiry date',
  );
  for (const appBaseUrl of ['javascript:alert(1)', 'file:///tmp/test', 'https://user:password@app.example']) {
    expect(() => renderMail({ template: 'recovery-notice', appBaseUrl }, 'App')).toThrow();
  }
});

test('uses email-change copy and routes notices to existing account pages without tokens', () => {
  const body = renderMail(
    { template: 'verification', code: '123456', expiresAt: '2026-10-03T12:00:00Z', emailChange: true },
    'App',
  );

  expect(body.text).toContain('new primary email');
  const recovery = renderMail(
    { template: 'recovery-notice', appBaseUrl: 'https://app.example?token=secret' },
    'App',
    'es',
  );

  expect(recovery.text).toContain('/app/es/security/sessions');
  expect(recovery.text).not.toContain('token=');
  expect(renderMail(examples[2], 'App').text).toContain('/app/en/auth/sign-in');
});
