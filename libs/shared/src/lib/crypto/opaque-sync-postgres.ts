import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { env } from '../env';
import { getPool } from '../db/pool';

import {
  deserializeEncryptedEnvelope,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope,
  type EncryptedEnvelope,
} from './encrypted-envelope';
import { RailwayS3ObjectStore, sha256, type OpaqueObjectStore } from './opaque-sync-object-store';

type DurableAppendResult = { cursor: number; duplicate: boolean; envelope: EncryptedEnvelope };
type DurableCheckpoint = { checkpointId: string; cursor: number; revision: number; envelope: EncryptedEnvelope };
type DurableOpaqueSyncConfig = {
  bucket: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
};

class PostgresOpaqueSyncRepository {
  constructor(
    private readonly pool: Pool,
    private readonly objects: OpaqueObjectStore,
    private readonly retentionMs = 30 * 24 * 60 * 60 * 1000,
  ) {}

  static fromConfig(pool: Pool, config: DurableOpaqueSyncConfig): PostgresOpaqueSyncRepository {
    return new PostgresOpaqueSyncRepository(pool, new RailwayS3ObjectStore(config));
  }

  async append(accountId: string, workspaceId: string, input: unknown, now = new Date()): Promise<DurableAppendResult> {
    const envelope = parseEncryptedEnvelope(input);

    if (envelope.kind !== 'sync-object' || envelope.workspaceId !== workspaceId) {
      throw new Error('Envelope is not authorized for this workspace.');
    }

    const key = `${accountId}/${workspaceId}/${envelope.envelopeId}/${envelope.revision}-${randomUUID()}.json`;
    const body = Buffer.from(serializeEncryptedEnvelope(envelope));
    const client = await this.pool.connect();
    let uploaded = false;

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO opaque_sync_cursors (account_id, workspace_id, high_water_cursor)
         VALUES ($1, $2, 0)
         ON CONFLICT (account_id, workspace_id) DO NOTHING`,
        [accountId, workspaceId],
      );
      const stream = await client.query<{ high_water_cursor: number }>(
        `SELECT high_water_cursor FROM opaque_sync_cursors
         WHERE account_id = $1 AND workspace_id = $2 FOR UPDATE`,
        [accountId, workspaceId],
      );
      const highWaterCursor = Number(stream.rows[0]?.high_water_cursor ?? 0);
      const highWaterRevisionResult = await client.query<{ high_water_revision: number }>(
        `SELECT COALESCE(MAX(revision), 0)::integer AS high_water_revision
         FROM opaque_sync_envelopes
         WHERE account_id = $1 AND workspace_id = $2`,
        [accountId, workspaceId],
      );
      const highWaterRevision = Number(highWaterRevisionResult.rows[0]?.high_water_revision ?? 0);
      const tombstone = await client.query<{ revision: number }>(
        `SELECT revision FROM opaque_sync_tombstones
         WHERE account_id = $1 AND workspace_id = $2 AND envelope_id = $3
         ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
        [accountId, workspaceId, envelope.envelopeId],
      );

      if (tombstone.rows[0] && envelope.revision < tombstone.rows[0].revision) {
        throw new Error('Envelope revision is a tombstoned replay.');
      }
      const existing = await client.query<{
        cursor: number;
        revision: number;
        object_key: string;
        ciphertext_sha256: string;
      }>(
        `SELECT cursor, revision, object_key, ciphertext_sha256
         FROM opaque_sync_envelopes
         WHERE account_id = $1 AND workspace_id = $2 AND envelope_id = $3
         ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
        [accountId, workspaceId, envelope.envelopeId],
      );
      const current = existing.rows[0];
      const baseCursorValue = envelope.metadata['baseCursor'];
      const baseCursor = Number(baseCursorValue);

      if (baseCursorValue !== undefined && Number.isFinite(baseCursor) && baseCursor < highWaterCursor) {
        throw new Error('Envelope has a stale stream base.');
      }
      const deletedRecordId = envelope.metadata['deletedRecordId'];

      if (deletedRecordId) {
        const deleted = await client.query(
          `SELECT 1 FROM opaque_sync_tombstones WHERE account_id = $1 AND workspace_id = $2 AND envelope_id = $3 LIMIT 1 FOR UPDATE`,
          [accountId, workspaceId, deletedRecordId],
        );

        if (deleted.rows[0]) throw new Error('Envelope would resurrect a tombstoned record.');
      }

      if (current && envelope.revision <= current.revision) {
        if (current.ciphertext_sha256 === sha256(body)) {
          await client.query('ROLLBACK');
          const existingBody = await this.objects.get(current.object_key);

          if (!existingBody) throw new Error('Opaque object reference is missing.');

          return {
            cursor: current.cursor,
            duplicate: true,
            envelope: deserializeEncryptedEnvelope(new TextDecoder().decode(existingBody)),
          };
        }
        throw new Error('Envelope revision is a replay.');
      }

      if (!current && envelope.revision <= highWaterRevision) {
        throw new Error('Envelope revision rolls back the stream.');
      }

      const cursorResult = await client.query<{ high_water_cursor: number }>(
        `UPDATE opaque_sync_cursors
         SET high_water_cursor = high_water_cursor + 1
         WHERE account_id = $1 AND workspace_id = $2
         RETURNING high_water_cursor`,
        [accountId, workspaceId],
      );
      const cursor = cursorResult.rows[0].high_water_cursor;

      await this.objects.put(key, body);
      uploaded = true;
      await client.query(
        `INSERT INTO opaque_sync_envelopes
          (account_id, workspace_id, envelope_id, revision, cursor, object_key, ciphertext_sha256,
           record_type, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          accountId,
          workspaceId,
          envelope.envelopeId,
          envelope.revision,
          cursor,
          key,
          sha256(body),
          envelope.recordType,
          now,
          new Date(now.getTime() + this.retentionMs),
        ],
      );
      if (envelope.recordType === 'tombstone') {
        await client.query(
          `INSERT INTO opaque_sync_tombstones (account_id, workspace_id, envelope_id, revision, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [
            accountId,
            workspaceId,
            envelope.envelopeId,
            envelope.revision,
            `client-tombstone${deletedRecordId ? `:${deletedRecordId}` : ''}`,
          ],
        );
      }
      await client.query('COMMIT');

      return { cursor, duplicate: false, envelope };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (uploaded) await this.objects.delete(key).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(
    accountId: string,
    workspaceId: string,
    afterCursor = 0,
    limit = 100,
  ): Promise<Array<{ cursor: number; envelope: EncryptedEnvelope }>> {
    const highWater = await this.pool.query<{ high_water_cursor: number }>(
      `SELECT high_water_cursor FROM opaque_sync_cursors WHERE account_id = $1 AND workspace_id = $2`,
      [accountId, workspaceId],
    );
    const highWaterCursor = Number(highWater.rows[0]?.high_water_cursor ?? 0);
    const firstRetained = await this.pool.query<{ cursor: number }>(
      `SELECT cursor FROM opaque_sync_envelopes
       WHERE account_id = $1 AND workspace_id = $2 AND expires_at > now() AND tombstoned_at IS NULL
       ORDER BY cursor ASC LIMIT 1`,
      [accountId, workspaceId],
    );
    const firstRetainedCursor = firstRetained.rows[0]?.cursor;

    if (
      afterCursor > highWaterCursor ||
      (firstRetainedCursor !== undefined && afterCursor < firstRetainedCursor - 1) ||
      (firstRetainedCursor === undefined && afterCursor < highWaterCursor)
    ) {
      throw new Error('Cursor requires recovery.');
    }
    const result = await this.pool.query<{ cursor: number; object_key: string }>(
      `SELECT cursor, object_key FROM opaque_sync_envelopes
       WHERE account_id = $1 AND workspace_id = $2 AND cursor > $3 AND expires_at > now() AND tombstoned_at IS NULL
       ORDER BY cursor ASC LIMIT $4`,
      [accountId, workspaceId, afterCursor, limit],
    );
    const envelopes = await Promise.all(
      result.rows.map(async ({ cursor, object_key }) => {
        const body = await this.objects.get(object_key);

        if (!body) throw new Error('Opaque object reference is missing.');

        return { cursor, envelope: deserializeEncryptedEnvelope(new TextDecoder().decode(body)) };
      }),
    );

    return envelopes;
  }

  async tombstone(
    accountId: string,
    workspaceId: string,
    envelopeId: string,
    revision: number,
    reason = 'retention',
  ): Promise<void> {
    await this.pool.query(
      `UPDATE opaque_sync_envelopes SET tombstoned_at = now()
       WHERE account_id = $1::text AND workspace_id = $2::text AND envelope_id = $3::text AND revision <= $4::integer`,
      [accountId, workspaceId, envelopeId, revision],
    );
    await this.pool.query(
      `INSERT INTO opaque_sync_tombstones (account_id, workspace_id, envelope_id, revision, reason)
       VALUES ($1::text, $2::text, $3::text, $4::integer, $5::text)
       ON CONFLICT DO NOTHING`,
      [accountId, workspaceId, envelopeId, revision, reason],
    );
  }

  async createCheckpoint(
    accountId: string,
    workspaceId: string,
    checkpointId: string,
    cursor: number,
    revision: number,
    envelope: unknown,
    now = new Date(),
  ): Promise<DurableCheckpoint> {
    const parsed = parseEncryptedEnvelope(envelope);

    if (parsed.kind !== 'sync-object' || parsed.workspaceId !== workspaceId)
      throw new Error('Checkpoint is not authorized for this workspace.');

    const key = `${accountId}/${workspaceId}/checkpoint/${checkpointId}.json`;
    const body = Buffer.from(serializeEncryptedEnvelope(parsed));
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const stream = await client.query<{ high_water_cursor: number }>(
        `SELECT high_water_cursor FROM opaque_sync_cursors WHERE account_id = $1 AND workspace_id = $2 FOR UPDATE`,
        [accountId, workspaceId],
      );

      if (!stream.rows[0] || cursor > stream.rows[0].high_water_cursor)
        throw new Error('Checkpoint cursor is not durable.');

      const chain = await client.query<{
        envelope_id: string;
        revision: number;
        object_key: string;
        ciphertext_sha256: string;
        tombstoned_at: Date | null;
      }>(
        `SELECT envelope_id, revision, object_key, ciphertext_sha256, tombstoned_at FROM opaque_sync_envelopes
          WHERE account_id = $1 AND workspace_id = $2 AND cursor = $3
          LIMIT 1`,
        [accountId, workspaceId, cursor],
      );
      const chainRow = chain.rows[0];

      if (!chainRow || chainRow.tombstoned_at || chainRow.revision !== revision)
        throw new Error('Checkpoint is not a member of the durable stream chain.');

      if (chainRow.envelope_id !== parsed.envelopeId)
        throw new Error('Checkpoint envelope does not match the durable stream object.');

      const chainBody = await this.objects.get(chainRow.object_key);

      if (!chainBody || sha256(chainBody) !== chainRow.ciphertext_sha256)
        throw new Error('Checkpoint stream object integrity could not be verified.');

      if (sha256(body) !== chainRow.ciphertext_sha256)
        throw new Error('Checkpoint envelope does not match the durable stream object.');

      const existing = await client.query<{ cursor: number; revision: number; ciphertext_sha256: string }>(
        `SELECT cursor, revision, ciphertext_sha256 FROM opaque_sync_checkpoints
         WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         FOR UPDATE`,
        [accountId, workspaceId, checkpointId],
      );

      if (existing.rows[0] && (existing.rows[0].cursor !== cursor || existing.rows[0].revision !== revision))
        throw new Error('Checkpoint would roll back an existing reference.');

      await this.objects.put(key, body);
      await client.query(
        `INSERT INTO opaque_sync_checkpoints (account_id, workspace_id, checkpoint_id, cursor, revision, object_key, ciphertext_sha256, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (account_id, workspace_id, checkpoint_id) DO UPDATE SET cursor = EXCLUDED.cursor, revision = EXCLUDED.revision, object_key = EXCLUDED.object_key, ciphertext_sha256 = EXCLUDED.ciphertext_sha256`,
        [accountId, workspaceId, checkpointId, cursor, revision, key, sha256(body), now],
      );
      await client.query('COMMIT');

      return { checkpointId, cursor, revision, envelope: parsed };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCheckpoint(accountId: string, workspaceId: string, checkpointId: string): Promise<DurableCheckpoint> {
    const result = await this.pool.query<{
      checkpoint_id: string;
      cursor: number;
      revision: number;
      object_key: string;
    }>(
      `SELECT checkpoint_id, cursor, revision, object_key FROM opaque_sync_checkpoints WHERE account_id=$1 AND workspace_id=$2 AND checkpoint_id=$3`,
      [accountId, workspaceId, checkpointId],
    );
    const row = result.rows[0];

    if (!row) throw new Error('Checkpoint was not found.');
    const body = await this.objects.get(row.object_key);

    if (!body) throw new Error('Checkpoint object reference is missing.');

    return {
      checkpointId: row.checkpoint_id,
      cursor: row.cursor,
      revision: row.revision,
      envelope: deserializeEncryptedEnvelope(new TextDecoder().decode(body)),
    };
  }

  async recovery(accountId: string, workspaceId: string, checkpointId: string, afterCursor = 0, limit = 100) {
    const checkpoint = await this.getCheckpoint(accountId, workspaceId, checkpointId);

    return {
      checkpoint,
      envelopes: await this.list(accountId, workspaceId, Math.max(checkpoint.cursor, afterCursor), limit),
    };
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);

      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

let configuredRepository: PostgresOpaqueSyncRepository | undefined;

function getConfiguredOpaqueSyncRepository(): PostgresOpaqueSyncRepository {
  if (env.OPAQUE_SYNC_STORAGE !== 'durable') throw new Error('Durable opaque sync storage is not enabled.');
  if (!env.OPAQUE_SYNC_S3_ENDPOINT || !env.OPAQUE_SYNC_S3_ACCESS_KEY || !env.OPAQUE_SYNC_S3_SECRET_KEY) {
    throw new Error('Durable opaque sync storage is missing object-store configuration.');
  }
  configuredRepository ??= PostgresOpaqueSyncRepository.fromConfig(getPool(), {
    endpoint: env.OPAQUE_SYNC_S3_ENDPOINT,
    bucket: env.OPAQUE_SYNC_S3_BUCKET,
    accessKey: env.OPAQUE_SYNC_S3_ACCESS_KEY,
    secretKey: env.OPAQUE_SYNC_S3_SECRET_KEY,
  });

  return configuredRepository;
}

export { PostgresOpaqueSyncRepository, getConfiguredOpaqueSyncRepository };
export type { DurableAppendResult, DurableCheckpoint, DurableOpaqueSyncConfig };
