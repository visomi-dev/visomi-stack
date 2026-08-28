import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryResultRow } from 'pg';

import { inventoryZeroPlaintext, type Queryable } from './zk014-zero-plaintext-inventory.ts';

test('records absent protected locations as zero absent-by-design without issuing a data query', async () => {
  const queries: string[] = [];
  const db: Queryable = {
    async query<T extends QueryResultRow>(text: string): Promise<{ rows: T[] }> {
      queries.push(text);
      return { rows: [] } as { rows: T[] };
    },
  };

  const rows = await inventoryZeroPlaintext(db, 'account-1', 'project-1');

  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => row.status === 'zero' && row.count === 0 && row.reason === 'absent-by-design'));
  assert.ok(queries.every((query) => query.includes('information_schema.columns')));
});

test('keeps existing locations fail-closed when the protected value cannot be queried', async () => {
  const db: Queryable = {
    async query<T extends QueryResultRow>(text: string): Promise<{ rows: T[] }> {
      if (text.includes('information_schema.columns')) {
        return {
          rows: [{ column_name: 'payload' }, { column_name: 'account_id' }, { column_name: 'project_id' }] as T[],
        };
      }
      throw new Error('database query unavailable');
    },
  };

  const rows = await inventoryZeroPlaintext(db, 'account-1', 'project-1');
  const existing = rows.find((row) => row.name === 'secondary_queues.payload');

  assert.deepEqual(existing, {
    name: 'secondary_queues.payload',
    count: null,
    status: 'unverified',
    reason: 'existing-location-query-failed',
  });
});

test('does not convert an existing location without scope columns into zero', async () => {
  const db: Queryable = {
    async query<T extends QueryResultRow>(text: string): Promise<{ rows: T[] }> {
      if (text.includes('information_schema.columns')) {
        return { rows: [{ column_name: 'payload' }] as T[] };
      }
      throw new Error('data query must not run without scope columns');
    },
  };

  const rows = await inventoryZeroPlaintext(db, 'account-1', 'project-1');
  const existing = rows.find((row) => row.name === 'secondary_queues.payload');
  assert.deepEqual(existing, {
    name: 'secondary_queues.payload',
    count: null,
    status: 'unverified',
    reason: 'scope-columns-unavailable',
  });
});
