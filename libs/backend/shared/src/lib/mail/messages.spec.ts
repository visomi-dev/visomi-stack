import { describe, expect, it, vi } from 'vitest';

import { AuthMail, renderMessage, type CodePurpose, type SecurityNotice } from './messages';

describe('shared authentication mail', () => {
  it('escapes dynamic email values and sanitizes transport failures', async () => {
    const message = renderMessage('verification', '<script>', '"quoted" & \'single\'', '123456');

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.text).toContain('123456');
    const security = renderMessage('security', 'Security', 'A setting changed.');

    expect(security.text).toContain('recover your account');
    await expect(new AuthMail().code('synthetic@example.test', 'recovery', '123456')).rejects.toThrow(
      'mail_unavailable',
    );
    await expect(new AuthMail().notice('synthetic@example.test', 'password_changed')).rejects.toThrow(
      'mail_unavailable',
    );
    const mail = new AuthMail({
      send: async () => {
        throw new Error('SYNTHETIC_SMTP_PASSWORD');
      },
      close() {
        return undefined;
      },
    });

    await expect(mail.code('synthetic@example.test', 'recovery', '123456')).rejects.toThrow('mail_unavailable');
    await expect(mail.notice('synthetic@example.test', 'password_changed')).rejects.toThrow('mail_unavailable');
  });
  it('renders and delivers each supported code and security notice through the injected transport', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const mail = new AuthMail({ send, close: vi.fn() });
    const purposes: CodePurpose[] = [
      'email_verify',
      'email_change',
      'password_login',
      'password_reset',
      'recovery',
      'google_login',
      'google_link',
      'google_reauth',
      'enrollment',
      'reauth',
    ];
    const notices: SecurityNotice[] = [
      'email_changed',
      'password_changed',
      'google_unlinked',
      'totp_enabled',
      'totp_disabled',
      'password_reset',
      'recovery_authorized',
      'password_recovered',
      'passkey_recovered',
    ];

    expect(send).not.toHaveBeenCalled();
    for (const purpose of purposes) {
      await mail.code('synthetic@example.test', purpose, '123456');
    }
    for (const notice of notices) {
      await mail.notice('synthetic@example.test', notice);
    }
    expect(send).toHaveBeenCalledTimes(purposes.length + notices.length);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'synthetic@example.test',
        subject: 'Verify your email',
        text: expect.stringContaining('123456'),
        html: expect.stringContaining('123456'),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Account security update',
        text: expect.stringContaining('Your password settings changed.'),
      }),
    );
  });
});
