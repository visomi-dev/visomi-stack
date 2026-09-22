import FormData from 'form-data';
import Mailgun from 'mailgun.js';

import { env } from '../shared/env';

import type { VerificationPurpose } from './auth-schemas';
import { APP_NAME } from './auth-brand';

import { HttpError } from 'shared';

export type VerificationMessage = {
  challengeId: string;
  email: string;
  expiresAt: Date;
  pin: string;
  purpose: VerificationPurpose;
};

export type SentVerificationMessage = VerificationMessage & {
  sentAt: Date;
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
  const intent =
    message.purpose === 'email_change'
      ? 'verify your new primary email address'
      : 'continue signing in or finish creating your account';
  const htmlName = APP_NAME.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return {
    html: `<p>Your ${htmlName} verification code is <strong>${message.pin}</strong>.</p><p>Use it to ${intent}. This code expires at ${message.expiresAt.toISOString()}.</p>`,
    subject: `Your ${APP_NAME} verification code`,
    text: `Your ${APP_NAME} verification code is ${message.pin}. Use it to ${intent}. This code expires at ${message.expiresAt.toISOString()}.`,
  };
}

export async function sendVerificationMessage(message: VerificationMessage) {
  const body = createMessageBody(message);

  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      ...message,
      sentAt: new Date(),
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

export async function sendRecoveryNotification(email: string): Promise<void> {
  const subject = `Your ${APP_NAME} account was recovered`;
  const text = `A lower-assurance email recovery was completed for your ${APP_NAME} account. If you did not do this, secure your account immediately.`;

  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      challengeId: 'recovery-notification',
      email,
      expiresAt: new Date(),
      pin: '',
      purpose: 'existing_account_recovery',
      sentAt: new Date(),
    });

    return;
  }
  const client = getMailgunClient();

  await client.messages.create(env.MAILGUN_DOMAIN, {
    from: env.MAILGUN_FROM,
    html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
    subject,
    text,
    to: [email],
  });
}

export function listSentMessages() {
  return mailbox.map((message) => ({ ...message }));
}

export async function sendEmailChangeNotification(email: string): Promise<void> {
  if (env.MAIL_TRANSPORT === 'memory') {
    mailbox.push({
      challengeId: 'email-change-notification',
      email,
      expiresAt: new Date(),
      pin: '',
      purpose: 'email_change',
      sentAt: new Date(),
    });

    return;
  }
  await getMailgunClient().messages.create(env.MAILGUN_DOMAIN, {
    from: env.MAILGUN_FROM,
    to: [email],
    subject: `Your ${APP_NAME} primary email changed`,
    text: `Your ${APP_NAME} primary email address was changed after verification. All existing sessions have been invalidated. If you did not request this change, contact support and secure your account immediately.`,
  });
}

export function clearMailbox() {
  mailbox.length = 0;
}
