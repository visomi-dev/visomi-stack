import type { MailTransport } from './smtp';
import { templates } from './templates.generated';

const copy = {
  email_verify: ['Verify your email', 'Enter this code to finish setting up your account.'],
  email_change: ['Confirm your new email', 'Enter this code to change your email address.'],
  password_login: ['Confirm your sign-in', 'Enter this code to finish signing in.'],
  password_reset: ['Reset your password', 'Enter this code to reset your password.'],
  recovery: ['Recover your account', 'Enter this code to start account recovery.'],
  google_login: ['Verify your email', 'Enter this code to confirm your email for Google sign-in.'],
  google_link: ['Verify your email', 'Enter this code to link Google to your account.'],
  google_reauth: ['Confirm your email', 'Enter this code to confirm your Google identity.'],
  enrollment: ['Confirm your new password', 'Enter this code to finish setting up your new sign-in method.'],
  reauth: ['Confirm your identity', 'Enter this code to confirm your identity.'],
} as const;

const notices = {
  email_changed: 'Your account email address changed.',
  password_changed: 'Your password settings changed.',
  google_unlinked: 'Google was disconnected from your account.',
  totp_enabled: 'An authenticator app was enabled for your account.',
  totp_disabled: 'Your authenticator app was removed.',
  password_reset: 'Your password was reset.',
  recovery_authorized: 'Account recovery was authorized.',
  password_recovered: 'Account recovery completed with a new password.',
  passkey_recovered: 'Account recovery completed with a new passkey.',
} as const;

export type SecurityNotice = keyof typeof notices;

export type CodePurpose = keyof typeof copy;
const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderMessage(kind: 'verification' | 'security', title: string, description: string, code = '') {
  const fields = { title, description, code };
  const html = templates[kind].replace(/\{\{(title|description|code)\}\}/g, (_match, field: keyof typeof fields) =>
    escape(fields[field]),
  );

  return {
    subject: title,
    html,
    text: `${title}\n\n${description}\n\n${code ? `${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.` : 'If you did not make this change, recover your account from the sign-in page.'}`,
  };
}

export class AuthMail {
  constructor(private readonly transport?: MailTransport) {}

  async code(to: string, purpose: CodePurpose, code: string) {
    if (!this.transport) {
      throw new Error('mail_unavailable');
    }

    const [title, description] = copy[purpose];

    try {
      await this.transport.send({ to, ...renderMessage('verification', title, description, code) });
    } catch {
      throw new Error('mail_unavailable');
    }
  }

  async notice(to: string, notice: SecurityNotice) {
    if (!this.transport) {
      throw new Error('mail_unavailable');
    }

    try {
      await this.transport.send({ to, ...renderMessage('security', 'Account security update', notices[notice]) });
    } catch {
      throw new Error('mail_unavailable');
    }
  }
}
