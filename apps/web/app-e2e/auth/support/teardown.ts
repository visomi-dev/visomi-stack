import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { stopTestPostgres } from '@visomi-stack/dev-testing/postgres';

export default async function teardown(): Promise<void> {
  const directory = process.env['VISOMI_E2E_TELEMETRY_DIR'];

  if (!directory) {
    return;
  }

  try {
    const result1 = await readFile(join(directory, 'postgres.json'), 'utf8');
    const owner = JSON.parse(result1);

    await stopTestPostgres(owner.directory, owner.compose);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
