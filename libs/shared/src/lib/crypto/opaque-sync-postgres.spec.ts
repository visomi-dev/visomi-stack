import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('opaque sync durable contract', () => {
  it('defines transactional metadata-only tables and no payload or key columns', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../../../../drizzle/20260819210000_opaque_sync_durable/migration.sql'),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "opaque_sync_cursors"');
    expect(migration).toContain('CREATE TABLE "opaque_sync_envelopes"');
    expect(migration).toContain('CREATE TABLE "opaque_sync_tombstones"');
    expect(migration).toContain('UNIQUE ("account_id", "workspace_id", "cursor")');
    expect(migration).toContain('"object_key" text NOT NULL');
    expect(migration).toContain('"ciphertext_sha256" text NOT NULL');
    expect(migration).not.toMatch(/plaintext|encryption_key|secret_key|ciphertext\s+jsonb/i);
  });
});
