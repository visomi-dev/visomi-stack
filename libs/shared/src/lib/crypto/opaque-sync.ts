import { parseEncryptedEnvelope, serializeEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';

type StoredOpaqueEnvelope = {
  accountId: string;
  cursor: number;
  expiresAt: number;
  envelope: EncryptedEnvelope;
  workspaceId: string;
};

type StreamState = {
  highWaterCursor: number;
  tombstoneHorizon: number;
  highWaterRevision: number;
};

type AppendResult = { cursor: number; duplicate: boolean; envelope: EncryptedEnvelope };

class OpaqueSyncStore {
  private readonly records: StoredOpaqueEnvelope[] = [];
  private readonly latestByEnvelope = new Map<string, StoredOpaqueEnvelope>();
  private readonly streams = new Map<string, StreamState>();
  private readonly tombstones = new Map<string, number>();
  private readonly checkpoints = new Map<
    string,
    { checkpointId: string; cursor: number; revision: number; envelope: EncryptedEnvelope }
  >();

  constructor(private readonly retentionMs = 30 * 24 * 60 * 60 * 1000) {}

  append(accountId: string, workspaceId: string, input: unknown, now = Date.now()): AppendResult {
    const envelope = parseEncryptedEnvelope(input);

    if (envelope.kind !== 'sync-object' || envelope.workspaceId !== workspaceId) {
      throw new Error('Envelope is not authorized for this workspace.');
    }

    this.prune(now);
    const envelopeKey = this.envelopeKey(accountId, workspaceId, envelope.envelopeId);
    const streamKey = this.streamKey(accountId, workspaceId);
    const stream = this.streams.get(streamKey) ?? { highWaterCursor: 0, tombstoneHorizon: 0, highWaterRevision: 0 };
    const existing = this.latestByEnvelope.get(envelopeKey);
    const tombstoneRevision = this.tombstones.get(envelopeKey);

    if (tombstoneRevision !== undefined && envelope.revision <= tombstoneRevision) {
      throw new Error('Envelope revision is a tombstoned replay.');
    }

    if (existing) {
      if (envelope.revision <= existing.envelope.revision) {
        if (serializeEncryptedEnvelope(existing.envelope) === serializeEncryptedEnvelope(envelope)) {
          return { cursor: existing.cursor, duplicate: true, envelope: existing.envelope };
        }

        throw new Error('Envelope revision is a replay.');
      }
    }

    if (!existing && envelope.revision <= stream.highWaterRevision) {
      throw new Error('Envelope revision rolls back the stream.');
    }

    const baseCursorValue = envelope.metadata['baseCursor'];
    const baseCursor = Number(baseCursorValue);

    if (baseCursorValue !== undefined && Number.isFinite(baseCursor) && baseCursor < stream.highWaterCursor) {
      throw new Error('Envelope has a stale stream base.');
    }
    const deletedRecordId = envelope.metadata['deletedRecordId'];

    if (
      deletedRecordId &&
      this.tombstones.get(this.envelopeKey(accountId, workspaceId, deletedRecordId)) !== undefined
    ) {
      throw new Error('Envelope would resurrect a tombstoned record.');
    }
    const cursor = stream.highWaterCursor + 1;
    const record = { accountId, cursor, expiresAt: now + this.retentionMs, envelope, workspaceId };

    this.records.push(record);
    this.latestByEnvelope.set(envelopeKey, record);
    stream.highWaterCursor = cursor;
    stream.highWaterRevision = Math.max(stream.highWaterRevision, envelope.revision);
    if (envelope.recordType === 'tombstone') {
      stream.tombstoneHorizon = Math.max(stream.tombstoneHorizon, envelope.revision);
      this.tombstones.set(envelopeKey, envelope.revision);
      if (deletedRecordId)
        this.tombstones.set(this.envelopeKey(accountId, workspaceId, deletedRecordId), envelope.revision);
    }
    this.streams.set(streamKey, stream);

    return { cursor, duplicate: false, envelope };
  }

  checkpoint(
    accountId: string,
    workspaceId: string,
    checkpointId: string,
    cursor: number,
    revision: number,
    envelope: EncryptedEnvelope,
  ) {
    const stream = this.streams.get(this.streamKey(accountId, workspaceId));

    const chainRecord = this.records.find(
      (record) =>
        record.accountId === accountId &&
        record.workspaceId === workspaceId &&
        record.cursor === cursor &&
        record.envelope.revision === revision,
    );

    if (!stream || !chainRecord || cursor > stream.highWaterCursor || envelope.workspaceId !== workspaceId)
      throw new Error('Checkpoint cursor is not durable.');

    if (
      chainRecord.envelope.envelopeId !== envelope.envelopeId ||
      serializeEncryptedEnvelope(chainRecord.envelope) !== serializeEncryptedEnvelope(envelope)
    )
      throw new Error('Checkpoint envelope does not match the durable stream object.');

    if (this.tombstones.get(this.envelopeKey(accountId, workspaceId, chainRecord.envelope.envelopeId)) !== undefined) {
      throw new Error('Checkpoint references a tombstoned chain entry.');
    }
    const value = { checkpointId, cursor, revision, envelope };

    this.checkpoints.set(`${accountId}\u0000${workspaceId}\u0000${checkpointId}`, value);

    return value;
  }

  recovery(accountId: string, workspaceId: string, checkpointId: string, afterCursor = 0, limit = 100) {
    const checkpoint = this.getCheckpoint(accountId, workspaceId, checkpointId);

    return {
      checkpoint,
      envelopes: this.list(accountId, workspaceId, Math.max(checkpoint.cursor, afterCursor), limit),
    };
  }

  getCheckpoint(accountId: string, workspaceId: string, checkpointId: string) {
    const value = this.checkpoints.get(`${accountId}\u0000${workspaceId}\u0000${checkpointId}`);

    if (!value) throw new Error('Checkpoint was not found.');

    return value;
  }

  list(accountId: string, workspaceId: string, afterCursor = 0, limit = 100, now = Date.now()) {
    this.prune(now);

    const stream = this.streams.get(this.streamKey(accountId, workspaceId));
    const streamRecords = this.records.filter(
      (record) => record.accountId === accountId && record.workspaceId === workspaceId,
    );
    const firstRetainedCursor = streamRecords[0]?.cursor;

    if (
      stream &&
      (afterCursor > stream.highWaterCursor ||
        (firstRetainedCursor !== undefined && afterCursor < firstRetainedCursor - 1) ||
        (firstRetainedCursor === undefined && afterCursor < stream.highWaterCursor))
    ) {
      throw new Error('Cursor requires recovery.');
    }

    return streamRecords
      .filter((record) => record.cursor > afterCursor)
      .slice(0, limit)
      .map(({ cursor, envelope }) => ({ cursor, envelope }));
  }

  clear() {
    this.records.length = 0;
    this.latestByEnvelope.clear();
    this.streams.clear();
    this.tombstones.clear();
    this.checkpoints.clear();
  }

  private prune(now: number) {
    const retained = this.records.filter(({ expiresAt }) => expiresAt > now);

    this.records.length = 0;
    this.records.push(...retained);
    const retainedKeys = new Set(
      retained.map((record) => this.envelopeKey(record.accountId, record.workspaceId, record.envelope.envelopeId)),
    );

    for (const key of this.latestByEnvelope.keys()) {
      if (!retainedKeys.has(key)) this.latestByEnvelope.delete(key);
    }
  }

  private streamKey(accountId: string, workspaceId: string): string {
    return `${accountId}\u0000${workspaceId}`;
  }

  private envelopeKey(accountId: string, workspaceId: string, envelopeId: string) {
    return `${accountId}\u0000${workspaceId}\u0000${envelopeId}`;
  }
}

const opaqueSyncStore = new OpaqueSyncStore();

export { OpaqueSyncStore, opaqueSyncStore };
export type { AppendResult, StoredOpaqueEnvelope };
