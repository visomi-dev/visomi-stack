import { describe, expect, it, vi, afterEach } from 'vitest';
import { createTransport } from 'nodemailer';

import { createSmtp, smtpConfig } from './smtp';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('SMTP resource ownership and privacy', () => {
  it('does not configure a transport until SMTP is explicitly provided', () => {
    expect(smtpConfig({})).toBeUndefined();
    expect(createTransport).not.toHaveBeenCalled();
    expect(smtpConfig({ SMTP_HOST: 'smtp.example.test' })).toEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      from: '',
      user: undefined,
      password: undefined,
      allowInsecureLocal: false,
    });
    expect(
      smtpConfig({
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_FROM: 'auth@example.test',
        SMTP_USER: 'synthetic',
        SMTP_PASSWORD: 'synthetic',
        SMTP_ALLOW_INSECURE_LOCAL: 'true',
      }),
    ).toMatchObject({ port: 465, secure: true, allowInsecureLocal: true });
  });
  it.each([
    { host: '' },
    { from: '' },
    { from: 'injection\r\nBcc: example.test' },
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { user: 'synthetic' },
    { password: 'synthetic' },
    { allowInsecureLocal: true },
  ])('rejects unsafe configuration %j', (change) => {
    expect(() =>
      createSmtp({ host: 'smtp.example.test', port: 587, secure: false, from: 'auth@example.test', ...change }),
    ).toThrow('smtp_configuration_invalid');
  });
  it.each([false, true])('requires TLS outside an explicitly local test mailbox: %s', (local) => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();

    vi.mocked(createTransport).mockReturnValue({ sendMail, close } as never);
    const transport = createSmtp({
      host: local ? '127.0.0.1' : 'smtp.example.test',
      port: local ? 2525 : 587,
      secure: false,
      from: 'auth@example.test',
      allowInsecureLocal: local,
      ...(local ? {} : { user: 'synthetic', password: 'synthetic' }),
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: !local,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(sendMail).not.toHaveBeenCalled();
    transport.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it('sanitizes failures while retaining only caller-controlled delivery fields', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);

    vi.mocked(createTransport).mockReturnValue({ sendMail, close: vi.fn() } as never);
    const transport = createSmtp({ host: 'localhost', port: 2525, secure: false, from: 'auth@example.test' });
    const message = { to: 'synthetic@example.test', subject: 'Synthetic', html: '<p>Test</p>', text: 'Test' };

    await transport.send(message);
    expect(sendMail).toHaveBeenCalledWith({ ...message, from: 'auth@example.test' });
    sendMail.mockRejectedValue(new Error('SYNTHETIC_SMTP_CREDENTIALS'));
    await expect(transport.send(message)).rejects.toThrow('mail_delivery_failed');
  });
});
