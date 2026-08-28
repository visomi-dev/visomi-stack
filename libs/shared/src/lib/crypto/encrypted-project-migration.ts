import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { parseEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';

type LegacyProjectRecord = {
  activity?: unknown;
  context?: unknown;
  id: string;
  projectId: string;
  updatedAt?: string;
};

type MigrationDecision =
  | { kind: 'migrated'; envelope: EncryptedEnvelope }
  | { kind: 'duplicate'; fingerprint: string }
  | { kind: 'deferred'; reason: 'unavailable' | 'partial' }
  | { kind: 'rejected'; reason: 'malformed' | 'tombstoned' };

type AgentEncrypt = (payload: string) => {
  authTag: string;
  ciphertext: string;
  nonce: string;
};

type MigrationInput = {
  accountId: string;
  envelopeId: string;
  record: LegacyProjectRecord;
  workspaceId: string;
  now?: Date;
  encrypt: AgentEncrypt;
};

type MigrationLedgerPersistence = {
  load: () => Readonly<Record<string, string>>;
  save: (fingerprints: Readonly<Record<string, string>>) => void;
};

type DurableMigrationRecord = {
  accountId: string;
  projectId: string;
  sourceId: string;
  fingerprint: string;
  tombstonedAt: Date | null;
};

const MAX_MIGRATION_PAYLOAD_BYTES = 256 * 1024;

function isPlainJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.every(isPlainJsonValue);
  const prototype = Object.getPrototypeOf(value);

  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isPlainJsonValue);
}

function fingerprint(envelope: EncryptedEnvelope): string {
  return createHash('sha256')
    .update(`${envelope.envelopeId}:${envelope.revision}:${envelope.ciphertext}:${envelope.authTag}`)
    .digest('hex');
}

/**
 * Converts one legacy row only after the local agent has supplied ciphertext.
 * The server may coordinate this function's result, but must not construct it
 * from plaintext or use the legacy fields as a fallback response.
 */
function migrateProjectRecord(input: MigrationInput): MigrationDecision {
  const { record } = input;

  if (!record.id || !record.projectId || record.projectId !== input.workspaceId) {
    return { kind: 'rejected', reason: 'malformed' };
  }

  const hasContext = record.context !== undefined && record.context !== null;
  const hasActivity = record.activity !== undefined && record.activity !== null;

  if (!hasContext && !hasActivity) {
    return { kind: 'deferred', reason: 'unavailable' };
  }

  if (hasContext !== hasActivity) {
    return { kind: 'deferred', reason: 'partial' };
  }

  if (
    !isPlainJsonValue(record.context) ||
    !isPlainJsonValue(record.activity) ||
    typeof record.context !== 'object' ||
    record.context === null ||
    Array.isArray(record.context) ||
    !Array.isArray(record.activity)
  ) {
    return { kind: 'rejected', reason: 'malformed' };
  }

  let payload: string;

  try {
    payload = JSON.stringify({ activity: record.activity, context: record.context });
  } catch {
    return { kind: 'rejected', reason: 'malformed' };
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_MIGRATION_PAYLOAD_BYTES) {
    return { kind: 'rejected', reason: 'malformed' };
  }

  let envelope: EncryptedEnvelope;

  try {
    const encrypted = input.encrypt(payload);

    envelope = parseEncryptedEnvelope({
      associatedData: { accountId: input.accountId, migration: 'project-context-activity-v1' },
      authTag: encrypted.authTag,
      ciphertext: encrypted.ciphertext,
      createdAt: input.now?.toISOString() ?? new Date().toISOString(),
      envelopeId: input.envelopeId,
      format: 'themis.encrypted-envelope',
      kind: 'sync-object',
      metadata: { source: 'local-agent-migration' },
      nonce: encrypted.nonce,
      recordType: 'project-context-activity',
      revision: 1,
      version: 1,
      workspaceId: input.workspaceId,
    });
  } catch {
    return { kind: 'rejected', reason: 'malformed' };
  }

  return { kind: 'migrated', envelope };
}

class MigrationLedger {
  private readonly fingerprints: Map<string, string>;
  private readonly tombstones = new Set<string>();

  constructor(private readonly persistence?: MigrationLedgerPersistence) {
    this.fingerprints = new Map(Object.entries(persistence?.load() ?? {}));
  }

  accept(decision: MigrationDecision): MigrationDecision {
    if (decision.kind !== 'migrated') {
      return decision;
    }

    const value = fingerprint(decision.envelope);

    if (this.tombstones.has(decision.envelope.envelopeId)) {
      return { kind: 'rejected', reason: 'tombstoned' };
    }

    const previous = this.fingerprints.get(decision.envelope.envelopeId);

    if (previous !== undefined) {
      return previous === value ? { kind: 'duplicate', fingerprint: value } : { kind: 'rejected', reason: 'malformed' };
    }

    this.fingerprints.set(decision.envelope.envelopeId, value);
    this.persistence?.save(Object.fromEntries(this.fingerprints));

    return decision;
  }

  tombstone(envelopeId: string): void {
    this.tombstones.add(envelopeId);
  }
}

/**
 * Transactional production ledger. The synchronous ledger above remains useful
 * for pure migration tests, but production migrations must use this adapter so
 * retries and tombstones survive process restarts and are isolated by account
 * and project.
 */
class PostgresMigrationLedger {
  private readonly ready: Promise<void>;

  constructor(
    private readonly pool: Pool,
    private readonly tableName = 'themis_migration_ledger',
  ) {
    this.ready = this.ensureTable();
  }

  async accept(input: {
    accountId: string;
    projectId: string;
    sourceId: string;
    decision: MigrationDecision;
  }): Promise<MigrationDecision> {
    if (input.decision.kind !== 'migrated') return input.decision;

    await this.ready;
    const value = fingerprint(input.decision.envelope);
    const result = await this.pool.query<DurableMigrationRecord>(
      `SELECT account_id AS "accountId", project_id AS "projectId", source_id AS "sourceId", fingerprint, tombstoned_at AS "tombstonedAt"
       FROM ${this.tableName} WHERE account_id = $1 AND project_id = $2 AND source_id = $3 FOR UPDATE`,
      [input.accountId, input.projectId, input.sourceId],
    );
    const existing = result.rows[0];

    if (existing) {
      if (existing.tombstonedAt) {
        return { kind: 'rejected', reason: 'tombstoned' };
      }

      return existing.fingerprint === value
        ? { kind: 'duplicate', fingerprint: value }
        : { kind: 'rejected', reason: 'malformed' };
    }

    await this.pool.query(
      `INSERT INTO ${this.tableName} (account_id, project_id, source_id, fingerprint, envelope_id, tombstoned_at)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [input.accountId, input.projectId, input.sourceId, value, input.decision.envelope.envelopeId],
    );

    return input.decision;
  }

  async tombstone(accountId: string, projectId: string, sourceId: string, at = new Date()): Promise<void> {
    await this.ready;
    await this.pool.query(
      `UPDATE ${this.tableName} SET tombstoned_at = $4 WHERE account_id = $1 AND project_id = $2 AND source_id = $3`,
      [accountId, projectId, sourceId, at],
    );
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        account_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        envelope_id TEXT NOT NULL,
        tombstoned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, project_id, source_id)
      )`,
    );
  }
}

export { MigrationLedger, PostgresMigrationLedger, migrateProjectRecord };
export type { AgentEncrypt, LegacyProjectRecord, MigrationDecision, MigrationInput, MigrationLedgerPersistence };
