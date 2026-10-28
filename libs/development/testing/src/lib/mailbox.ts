import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readMailCode(email: string) {
  const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

  if (!directory) {
    throw new Error('isolated_mailbox_required');
  }

  const contents = await readFile(join(directory, 'mailbox.jsonl'), 'utf8');
  const messages = contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; raw: string });
  const message = messages.filter((entry) => entry.to === email).slice(-1)[0];
  const code = message?.raw.match(/\b\d{6}\b/)?.[0];

  if (!code) {
    throw new Error('synthetic_mail_not_found');
  }

  return code;
}
