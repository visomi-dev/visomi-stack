import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Pool } from 'pg';

type InventoryRow = { name: string; status: 'zero' | 'non-zero' | 'unverified'; count: number | null; reason?: string };
const accountId = process.env.ZK008_ACCOUNT_ID;
const projectId = process.env.ZK008_PROJECT_ID;
const output = process.env.ZK008_INVENTORY_OUTPUT ?? 'dist/test-results/zk008/zero-plaintext-inventory.json';
if (!accountId || !projectId) throw new Error('ZK008_ACCOUNT_ID and ZK008_PROJECT_ID are required.');

const locations = [
  ['projects.summary', 'projects', 'summary IS NOT NULL'],
  ['project_documents.content_markdown', 'project_documents', 'content_markdown IS NOT NULL'],
  [
    'async_jobs.payload',
    'async_jobs',
    '(input_json IS NOT NULL OR result_json IS NOT NULL OR error_message IS NOT NULL)',
  ],
  ['queues.payload', 'queue_messages', 'payload IS NOT NULL'],
  ['realtime.payload', 'realtime_messages', 'payload IS NOT NULL'],
  ['logs.message', 'application_logs', 'message IS NOT NULL'],
  ['fixtures.payload', 'fixtures', 'payload IS NOT NULL'],
  ['backups.payload', 'backups', 'payload IS NOT NULL'],
] as const;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const rows: InventoryRow[] = [];
for (const [name, table, predicate] of locations) {
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE account_id = $1 AND project_id = $2 AND ${predicate}`,
      [accountId, projectId],
    );
    const count = Number(result.rows[0]?.count ?? 0);
    rows.push({ name, count, status: count === 0 ? 'zero' : 'non-zero' });
  } catch (error) {
    rows.push({
      name,
      count: null,
      status: 'unverified',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
const report = { accountId, projectId, generatedAt: new Date().toISOString(), plaintextValuesIncluded: false, rows };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
await pool.end();
if (rows.some((row) => row.status !== 'zero')) process.exitCode = 2;
