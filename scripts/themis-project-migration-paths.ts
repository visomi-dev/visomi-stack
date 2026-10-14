import { join } from 'node:path';

import { paths } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

export const migrationPaths = (root: string) => {
  const base = join(paths(root).directory, 'migration');

  return {
    base,
    ledger: join(base, 'ledger.json'),
    cutover: join(base, 'cutover.json'),
    backup: join(base, 'backups'),
    projects: join(paths(root).directory, 'projects'),
    quarantine: join(base, 'quarantine.json'),
    logs: join(base, 'logs'),
  };
};
