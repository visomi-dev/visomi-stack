import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMailCode } from './mailbox';

afterEach(() => vi.unstubAllEnvs());

describe('isolated SMTP mailbox reader', () => {
  it('requires an explicitly owned test directory', async () => {
    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', undefined);

    await expect(readMailCode('synthetic@example.test')).rejects.toThrow('isolated_mailbox_required');
  });
  it('reads the latest matching code without confusing another recipient or notification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'visomi-test-mailbox-'));

    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', directory);

    try {
      const records = [
        { to: 'synthetic@example.test', raw: 'Code 123456' },
        { to: 'other@example.test', raw: 'Code 654321' },
      ];

      await writeFile(
        join(directory, 'mailbox.jsonl'),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );

      const code = await readMailCode('synthetic@example.test');

      expect(code).toBe('123456');

      await expect(readMailCode('missing@example.test')).rejects.toThrow('synthetic_mail_not_found');

      await writeFile(
        join(directory, 'mailbox.jsonl'),
        JSON.stringify({ to: 'synthetic@example.test', raw: 'No code' }) + '\n',
      );

      await expect(readMailCode('synthetic@example.test')).rejects.toThrow('synthetic_mail_not_found');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
