import { parseEncryptedEnvelope, serializeEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';

export type SyncCursor = { workspaceId: string; value: number };
export type SyncQueueEntry = { envelope: string; attempts: number; nextAttemptAt: number };
export type SyncState = {
  cursor: SyncCursor;
  queue: SyncQueueEntry[];
  tombstones: string[];
};

export type SyncStateStore = {
  load(): Promise<SyncState | undefined>;
  save(state: SyncState): Promise<void>;
};

export type OpaqueSyncTransport = {
  append(envelope: EncryptedEnvelope): Promise<{ cursor: number; duplicate: boolean }>;
  list(afterCursor: number): Promise<ReadonlyArray<{ cursor: number; envelope: EncryptedEnvelope }>>;
};

export type OpaqueSyncTransportOptions = {
  baseUrl: string;
  workspaceId: string;
  deviceId: string;
  enrollmentVersion: number;
  fetcher?: typeof fetch;
};

/** Creates the shared HTTP adapter used by both the browser and agent clients. */
export function createOpaqueSyncHttpTransport(options: OpaqueSyncTransportOptions): OpaqueSyncTransport {
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.baseUrl.replace(/\/$/, '')}/sync/${encodeURIComponent(options.workspaceId)}/envelopes`;
  const headers = { 'content-type': 'application/json' };

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(url + path, { ...init, headers: { ...headers, ...init?.headers } });

    if (!response.ok) throw new Error(`Opaque sync request failed with status ${response.status}.`);

    return response.json() as Promise<unknown>;
  }

  return {
    async append(envelope) {
      const body = await request('', {
        method: 'POST',
        body: JSON.stringify({ deviceId: options.deviceId, enrollmentVersion: options.enrollmentVersion, envelope }),
      });
      const data = body as { data?: { cursor?: unknown; duplicate?: unknown } };

      if (typeof data.data?.cursor !== 'number' || typeof data.data.duplicate !== 'boolean')
        throw new Error('Malformed opaque sync response.');

      return { cursor: data.data.cursor, duplicate: data.data.duplicate };
    },
    async list(afterCursor) {
      const body = await request(
        `?afterCursor=${afterCursor}&limit=100&deviceId=${encodeURIComponent(options.deviceId)}&enrollmentVersion=${options.enrollmentVersion}`,
      );
      const data = body as { data?: { envelopes?: unknown } };

      if (!Array.isArray(data.data?.envelopes)) throw new Error('Malformed opaque sync response.');

      return data.data.envelopes.map((record) => {
        const value = record as { cursor?: unknown; envelope?: unknown };

        if (typeof value.cursor !== 'number') throw new Error('Malformed opaque sync cursor.');

        return { cursor: value.cursor, envelope: parseEncryptedEnvelope(value.envelope) };
      });
    },
  };
}

export type ProjectionChange = {
  entityId: string;
  entityType: 'work' | 'planning' | 'progress';
  operation: 'upsert' | 'delete';
  revision: number;
  actorId: string;
  envelopeId: string;
  value?: Record<string, string | number>;
};

export type ProjectionMerge = {
  work: ReadonlyArray<ProjectionChange>;
  planning: ReadonlyArray<ProjectionChange>;
  progress: ReadonlyArray<ProjectionChange>;
  tombstones: ReadonlyArray<string>;
};

export class SyncOfflineError extends Error {
  constructor(readonly cause?: unknown) {
    super('Opaque synchronization is offline.');
    this.name = 'SyncOfflineError';
  }
}

function compareChange(left: ProjectionChange, right: ProjectionChange): number {
  if (left.revision !== right.revision) return left.revision - right.revision;
  if (left.operation !== right.operation) return left.operation === 'delete' ? 1 : -1;
  if (left.actorId !== right.actorId) return left.actorId < right.actorId ? -1 : 1;

  return left.envelopeId < right.envelopeId ? -1 : left.envelopeId === right.envelopeId ? 0 : 1;
}

/**
 * Merges decrypted client changes locally. The cloud only sees the opaque
 * envelope and never participates in this ordering decision.
 */
export function mergeProjectionChanges(changes: ReadonlyArray<ProjectionChange>): ProjectionMerge {
  const winners = new Map<string, ProjectionChange>();

  for (const change of changes) {
    const previous = winners.get(`${change.entityType}:${change.entityId}`);

    if (!previous || compareChange(previous, change) < 0)
      winners.set(`${change.entityType}:${change.entityId}`, change);
  }

  const selected = [...winners.values()];
  const tombstones = selected
    .filter((change) => change.operation === 'delete')
    .map((change) => change.entityId)
    .sort();
  const active = selected.filter((change) => change.operation === 'upsert' && !tombstones.includes(change.entityId));

  return {
    work: active.filter((change) => change.entityType === 'work').sort(compareChange),
    planning: active.filter((change) => change.entityType === 'planning').sort(compareChange),
    progress: active.filter((change) => change.entityType === 'progress').sort(compareChange),
    tombstones,
  };
}

export class MemorySyncStateStore implements SyncStateStore {
  private state: SyncState | undefined;

  async load(): Promise<SyncState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: SyncState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export abstract class ClientSyncAdapter {
  private state: SyncState;

  public constructor(
    private readonly workspaceId: string,
    private readonly transport: OpaqueSyncTransport,
    private readonly stateStore: SyncStateStore,
    private readonly maxAttempts = 5,
  ) {
    this.state = { cursor: { workspaceId, value: 0 }, queue: [], tombstones: [] };
  }

  async initialize(): Promise<void> {
    const stored = await this.stateStore.load();

    if (stored?.cursor.workspaceId === this.workspaceId) this.state = stored;
  }

  async enqueue(envelope: EncryptedEnvelope): Promise<void> {
    const parsed = parseEncryptedEnvelope(envelope);

    if (parsed.kind !== 'sync-object' || parsed.workspaceId !== this.workspaceId)
      throw new Error('Envelope workspace mismatch.');
    if (this.state.tombstones.includes(parsed.envelopeId)) return;
    this.state.queue.push({ envelope: serializeEncryptedEnvelope(parsed), attempts: 0, nextAttemptAt: 0 });
    await this.persist();
  }

  async flush(now = Date.now()): Promise<{ sent: number; pending: number }> {
    let sent = 0;

    for (const entry of [...this.state.queue]) {
      if (entry.nextAttemptAt > now) continue;
      try {
        await this.transport.append(parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown));
        this.state.queue = this.state.queue.filter((candidate) => candidate !== entry);
        sent += 1;
      } catch (error: unknown) {
        entry.attempts += 1;
        if (entry.attempts >= this.maxAttempts) throw new SyncOfflineError(error);
        entry.nextAttemptAt = now + 2 ** entry.attempts * 1000;
      }
    }
    await this.persist();

    return { sent, pending: this.state.queue.length };
  }

  async pull(): Promise<ReadonlyArray<EncryptedEnvelope>> {
    let records: ReadonlyArray<{ cursor: number; envelope: EncryptedEnvelope }>;

    try {
      records = await this.transport.list(this.state.cursor.value);
    } catch (error: unknown) {
      throw new SyncOfflineError(error);
    }
    const accepted: EncryptedEnvelope[] = [];

    for (const record of [...records].sort((left, right) => left.cursor - right.cursor)) {
      if (record.cursor <= this.state.cursor.value) continue;
      const envelope = parseEncryptedEnvelope(record.envelope);

      if (envelope.workspaceId !== this.workspaceId) continue;
      if (envelope.metadata['tombstone'] === 'true') {
        this.state.tombstones = [...new Set([...this.state.tombstones, envelope.envelopeId])].sort();
      } else if (!this.state.tombstones.includes(envelope.envelopeId)) {
        accepted.push(envelope);
      }
      this.state.cursor = { workspaceId: this.workspaceId, value: record.cursor };
    }
    await this.persist();

    return accepted;
  }

  snapshot(): SyncState {
    return structuredClone(this.state);
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(structuredClone(this.state));
  }
}

export class BrowserSyncAdapter extends ClientSyncAdapter {}
export class AgentSyncAdapter extends ClientSyncAdapter {}
