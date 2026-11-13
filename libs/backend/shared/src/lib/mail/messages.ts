import { inject, InjectionToken } from '../injection';

import { MAIL_TRANSPORT, type MailTransport } from './smtp';
import { templates } from './templates.generated';

export const MAIL_ORIGIN = new InjectionToken<string>('canonical mail asset origin');

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

export function renderMessage(
  origin: string,
  kind: 'verification' | 'security',
  title: string,
  description: string,
  code = '',
) {
  const fields = { title, description, code, origin: new URL(origin).origin };
  const html = templates[kind].replace(
    /\{\{\s*(title|description|code|origin)\s*\}\}/g,
    (_match, field: keyof typeof fields) => escape(fields[field]),
  );

  return {
    subject: title,
    html,
    text: `${title}\n\n${description}\n\n${code ? `${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.` : 'If you did not make this change, recover your account from the sign-in page.'}`,
  };
}

export class AuthMail {
  private readonly transport = inject<MailTransport>(MAIL_TRANSPORT, { optional: true });
  private readonly origin = inject(MAIL_ORIGIN, { optional: true });

  async code(to: string, purpose: CodePurpose, code: string) {
    if (!this.transport || !this.origin) {
      throw new Error('mail_unavailable');
    }

    const [title, description] = copy[purpose];

    try {
      await this.transport.send({ to, ...renderMessage(this.origin, 'verification', title, description, code) });
    } catch {
      throw new Error('mail_unavailable');
    }
  }

  async notice(to: string, notice: SecurityNotice) {
    if (!this.transport || !this.origin) {
      throw new Error('mail_unavailable');
    }

    try {
      await this.transport.send({
        to,
        ...renderMessage(this.origin, 'security', 'Account security update', notices[notice]),
      });
    } catch {
      throw new Error('mail_unavailable');
    }
  }
}
