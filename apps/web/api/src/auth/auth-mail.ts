import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import { eq } from 'drizzle-orm';

import { env } from '../shared/env';

import type { VerificationPurpose } from './auth-schemas';
import { APP_NAME } from './auth-brand';

import { HttpError, db, users, renderMail, normalizeMailLocale } from 'shared';
import type { MailBody, MailLocale } from 'shared';

export type VerificationMessage = {
  challengeId: string;
  email: string;
  expiresAt: Date;
  pin: string;
  purpose: VerificationPurpose;
  locale?: MailLocale;
};

export type SentVerificationMessage = VerificationMessage & {
  sentAt: Date;
  body: MailBody;
};

const mailbox: SentVerificationMessage[] = [];

let mailgunClient: ReturnType<InstanceType<typeof Mailgun>['client']> | undefined;

export function getMailgunClient() {
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    throw new HttpError({
      code: 'mailgun_not_configured',
      message: 'Mailgun credentials are not configured.',
      statusCode: 500,
    });
  }

  if (!mailgunClient) {
    const mailgun = new Mailgun(FormData);

    mailgunClient = mailgun.client({
      key: env.MAILGUN_API_KEY,
      url: env.MAILGUN_URL,
      username: 'api',
    });
  }

  return mailgunClient;
}

export function createMessageBody(message: VerificationMessage) {
  return renderMail(
    {
      template: 'verification',
      code: message.pin,
      expiresAt: message.expiresAt.toISOString(),
      emailChange: message.purpose === 'email_change',
    },
    APP_NAME,
    message.locale,
  );
}

async function recipientLocale(email: string, locale?: MailLocale): Promise<MailLocale> {
  if (locale) return locale;
  const [recipient] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return normalizeMailLocale(recipient?.preferences.locale);
}

export async function sendVerificationMessage(message: VerificationMessage) {
  const locale = await recipientLocale(message.email, message.locale);
  const body = createMessageBody({ ...message, locale });

  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      ...message,
      sentAt: new Date(),
      locale,
      body,
    });

    return;
  }

  const client = getMailgunClient();

  await client.messages.create(env.MAILGUN_DOMAIN, {
    from: env.MAILGUN_FROM,
    html: body.html,
    subject: body.subject,
    text: body.text,
    to: [message.email],
  });
}

export async function sendRecoveryNotification(email: string, requestedLocale?: MailLocale): Promise<void> {
  const locale = await recipientLocale(email, requestedLocale);
  const body = renderMail({ template: 'recovery-notice', appBaseUrl: env.APP_BASE_URL }, APP_NAME, locale);

  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      challengeId: 'recovery-notification',
      email,
      expiresAt: new Date(),
      pin: '',
      purpose: 'existing_account_recovery',
      sentAt: new Date(),
      locale,
      body,
    });

    return;
  }
  const client = getMailgunClient();

  await client.messages.create(env.MAILGUN_DOMAIN, {
    from: env.MAILGUN_FROM,
    ...body,
    to: [email],
  });
}

export function listSentMessages() {
  return mailbox.map((message) => ({ ...message }));
}

export async function sendEmailChangeNotification(email: string, requestedLocale?: MailLocale): Promise<void> {
  const locale = await recipientLocale(email, requestedLocale);
  const body = renderMail({ template: 'email-change-notice', appBaseUrl: env.APP_BASE_URL }, APP_NAME, locale);

  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      challengeId: 'email-change-notification',
      email,
      expiresAt: new Date(),
      pin: '',
      purpose: 'email_change',
      sentAt: new Date(),
      locale,
      body,
    });

    return;
  }
  await getMailgunClient().messages.create(env.MAILGUN_DOMAIN, {
    from: env.MAILGUN_FROM,
    to: [email],
    ...body,
  });
}

export function clearMailbox() {
  mailbox.length = 0;
}
