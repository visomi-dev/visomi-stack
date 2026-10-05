import Handlebars from 'handlebars';
import { DateTime } from 'luxon';

import { englishMailCopy, spanishMailCopy, emailTemplates } from './generated/email-resources';

export type MailLocale = 'en' | 'es';
export type MailMessage =
  | { template: 'verification'; code: string; expiresAt: string; emailChange?: boolean }
  | { template: 'recovery-notice' | 'email-change-notice'; appBaseUrl: string };
export type MailBody = { subject: string; html: string; text: string };

const templates = {
  verification: Handlebars.compile(emailTemplates.verification, { strict: true }),
  'recovery-notice': Handlebars.compile(emailTemplates['recovery-notice'], { strict: true }),
  'email-change-notice': Handlebars.compile(emailTemplates['email-change-notice'], { strict: true }),
};
const textTemplate = Handlebars.compile(
  '{{appName}}\n\n{{copy.title}}\n\n{{copy.body}}\n\n' +
    '{{#if code}}{{copy.codeLabel}}: {{code}}\n{{copy.expiresLabel}} {{expiresAt}}\n\n{{/if}}' +
    '{{#if actionUrl}}{{copy.action}}: {{actionUrl}}\n\n{{/if}}' +
    '{{copy.safety}}\n\n{{footer}}',
  { strict: true, noEscape: true },
);

export function normalizeMailLocale(locale?: string): MailLocale {
  return /^es(?:-|$)/i.test(locale ?? '') ? 'es' : 'en';
}

/** Operational mail only. Never pass decrypted content or vault keys to this renderer. */
export function renderMail(message: MailMessage, appName: string, requestedLocale?: string): MailBody {
  if (!appName.trim() || /[\r\n]/.test(appName)) {
    throw new Error('Invalid mail application name.');
  }

  const locale = normalizeMailLocale(requestedLocale);
  const catalog = locale === 'es' ? spanishMailCopy : englishMailCopy;
  const selected = catalog[message.template];
  const body: string = selected.body;
  const copy = { ...selected, body };

  if (message.template === 'verification' && message.emailChange) {
    copy.body = catalog.verification.emailChangeBody;
  }

  const expiry = 'expiresAt' in message ? DateTime.fromISO(message.expiresAt, { zone: 'utc' }) : undefined;

  if (expiry && !expiry.isValid) {
    throw new Error('Invalid mail expiry date.');
  }

  if ('code' in message && !/^[0-9]{6}$/.test(message.code)) {
    throw new Error('Invalid mail verification code.');
  }

  let actionUrl: string | undefined;

  if ('appBaseUrl' in message) {
    const base = new URL(message.appBaseUrl);

    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
      throw new Error('Invalid mail application URL.');
    }

    const path = message.template === 'recovery-notice' ? 'security/sessions' : 'auth/sign-in';

    actionUrl = new URL(`/app/${locale}/${path}`, base).href;
  }

  const subject = `${appName}: ${copy.subject}`;
  const context = {
    appName,
    subject,
    locale,
    copy,
    footer: catalog.footer,
    code: 'code' in message ? message.code : undefined,
    expiresAt: expiry?.setLocale(locale).toLocaleString(DateTime.DATETIME_FULL),
    actionUrl,
  };

  return { subject, html: templates[message.template](context), text: textTemplate(context) };
}
