import FormData from 'form-data';
import Mailgun from 'mailgun.js';

import { env } from '../shared/env';

import type { VerificationPurpose } from './auth-schemas';

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
  const intent = message.purpose === 'sign_in' ? 'sign in' : 'finish creating your account';

  return {
    html: `<p>Your Themis verification code is <strong>${message.pin}</strong>.</p><p>Use it to ${intent}. This code expires at ${message.expiresAt.toISOString()}.</p>`,
    subject: 'Your Themis verification code',
    text: `Your Themis verification code is ${message.pin}. Use it to ${intent}. This code expires at ${message.expiresAt.toISOString()}.`,
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

export function listSentMessages() {
  return mailbox.map((message) => ({ ...message }));
}

export function clearMailbox() {
  mailbox.length = 0;
}
