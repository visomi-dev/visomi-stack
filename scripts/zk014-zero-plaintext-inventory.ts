import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Pool, type QueryResultRow } from 'pg';

type Location = {
  name: string;
  table: string;
  column: string;
  predicate: string;
};

const locations: readonly Location[] = [
  {
    name: 'projects.summary',
    table: 'projects',
    column: 'summary',
    predicate: "summary IS NOT NULL AND summary <> ''",
  },
  {
    name: 'project_documents.content_markdown',
    table: 'project_documents',
    column: 'content_markdown',
    predicate: "content_markdown IS NOT NULL AND content_markdown <> ''",
  },
  { name: 'async_jobs.input_json', table: 'async_jobs', column: 'input_json', predicate: 'input_json IS NOT NULL' },
  { name: 'async_jobs.result_json', table: 'async_jobs', column: 'result_json', predicate: 'result_json IS NOT NULL' },
  {
    name: 'async_jobs.error_message',
    table: 'async_jobs',
    column: 'error_message',
    predicate: "error_message IS NOT NULL AND error_message <> ''",
  },
  { name: 'secondary_queues.payload', table: 'secondary_queues', column: 'payload', predicate: 'payload IS NOT NULL' },
  { name: 'realtime.payload', table: 'realtime_messages', column: 'payload', predicate: 'payload IS NOT NULL' },
  {
    name: 'logs.message',
    table: 'application_logs',
    column: 'message',
    predicate: "message IS NOT NULL AND message <> ''",
  },
  { name: 'fixtures.payload', table: 'fixtures', column: 'payload', predicate: 'payload IS NOT NULL' },
  { name: 'backups.payload', table: 'backups', column: 'payload', predicate: 'payload IS NOT NULL' },
];

export type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
};

const scopePredicate = (table: string): { sql: string; values: string[] } => {
  // Every production table must expose both scope columns. Missing columns are
  // reported as unverified rather than silently interpreted as zero.
  return { sql: `account_id = $1 AND project_id = $2`, values: [accountId, projectId] };
};

export type InventoryRow = {
  name: string;
  count: number | null;
  status: 'zero' | 'non-zero' | 'unverified';
  reason?: string;
};

export const inventoryZeroPlaintext = async (
  db: Queryable,
  accountId: string,
  projectId: string,
): Promise<InventoryRow[]> => {
  const rows: InventoryRow[] = [];

  for (const location of locations) {
    try {
      // Catalog inspection is deliberately first: destructive migrations make
      // several historical protected locations absent by design.
      const catalog = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
           AND column_name = ANY($2::text[])`,
        [location.table, [location.column, 'account_id', 'project_id']],
      );
      const columns = new Set(catalog.rows.map((row) => row.column_name));
      if (!columns.has(location.column)) {
        rows.push({ name: location.name, count: 0, status: 'zero', reason: 'absent-by-design' });
        continue;
      }
      if (!columns.has('account_id') || !columns.has('project_id')) {
        rows.push({ name: location.name, count: null, status: 'unverified', reason: 'scope-columns-unavailable' });
        continue;
      }

      const scope = scopePredicate(location.table);
      const result = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${location.table} WHERE ${scope.sql} AND ${location.predicate}`,
        scope.values,
      );
      const count = Number(result.rows[0]?.count ?? '0');
      rows.push({ name: location.name, count, status: count === 0 ? 'zero' : 'non-zero' });
    } catch {
      // An existing location that cannot be queried is never treated as zero.
      rows.push({ name: location.name, count: null, status: 'unverified', reason: 'existing-location-query-failed' });
    }
  }

  return rows;
};

const main = async (): Promise<void> => {
  const accountId = process.env.ZK014_ACCOUNT_ID;
  const projectId = process.env.ZK014_PROJECT_ID;
  const output = process.env.ZK014_INVENTORY_OUTPUT ?? 'dist/test-results/zk014/zero-plaintext-inventory.json';
  if (!accountId || !projectId) {
    throw new Error('ZK014_ACCOUNT_ID and ZK014_PROJECT_ID are required; refusing an unscoped inventory.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/themis',
  });
  try {
    const rows = await inventoryZeroPlaintext(pool, accountId, projectId);
    const report = {
      accountId,
      projectId,
      generatedAt: new Date().toISOString(),
      plaintextValuesIncluded: false,
      locations: rows,
      releaseBlocking: rows.some((row) => row.status !== 'zero'),
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Wrote scoped zero-plaintext inventory to ${output}`);
    console.log(JSON.stringify(report));
    if (report.releaseBlocking) process.exitCode = 2;
  } finally {
    await pool.end();
  }
};

if (process.argv[1]?.endsWith('zk014-zero-plaintext-inventory.ts')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Inventory failed (redacted).'}\n`);
    process.exitCode = 1;
  });
}
