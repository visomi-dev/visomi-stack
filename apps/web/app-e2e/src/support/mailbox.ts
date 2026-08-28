import type { APIRequestContext } from '@playwright/test';

type AuthMode = 'sign_in' | 'sign_up';

type MailboxMessage = {
  email: string;
  pin: string;
  purpose: AuthMode;
};

export const clearMailbox = async (request: APIRequestContext) => {
  await request.delete('/api/test/mailbox');
};

export const readLatestPin = async (request: APIRequestContext, email: string, purpose: AuthMode) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request.get(
      `/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=${purpose}`,
    );

    if (response.ok()) {
      const payload = (await response.json()) as MailboxMessage;

      if (payload.pin) {
        return payload.pin;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No mailbox entry was found for ${email} (${purpose}).`);
};
