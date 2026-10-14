import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { renderMail } from '../libs/backend/shared/src/lib/mail/render-mail';
import type { MailMessage } from '../libs/backend/shared/src/lib/mail/render-mail';

async function preview(): Promise<void> {
  const directory = resolve('dist/email-previews');
  const messages: MailMessage[] = [
    { template: 'verification', code: '123456', expiresAt: '2026-10-03T12:00:00Z' },
    { template: 'recovery-notice', appBaseUrl: 'https://app.example' },
    { template: 'email-change-notice', appBaseUrl: 'https://app.example' },
  ];

  await mkdir(directory, { recursive: true });
  for (const locale of ['en', 'es'] as const) {
    for (const message of messages) {
      const body = renderMail(message, 'Example App', locale);
      const path = resolve(directory, `${message.template}.${locale}`);

      await writeFile(`${path}.html`, body.html);
      await writeFile(`${path}.txt`, body.text);
    }
  }

  console.log(`Email previews written to ${directory}`);
}

preview().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
