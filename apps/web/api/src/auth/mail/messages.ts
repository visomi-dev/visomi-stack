import type { MailTransport } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';

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
      throw new HttpError(503, 'mail_unavailable');
    }

    const [title, description] = copy[purpose];

    try {
      await this.transport.send({ to, ...renderMessage('verification', title, description, code) });
    } catch {
      throw new HttpError(503, 'mail_unavailable');
    }
  }

  async notice(to: string, description: string) {
    if (!this.transport) {
      throw new HttpError(503, 'mail_unavailable');
    }

    try {
      await this.transport.send({ to, ...renderMessage('security', 'Account security update', description) });
    } catch {
      throw new HttpError(503, 'mail_unavailable');
    }
  }
}
