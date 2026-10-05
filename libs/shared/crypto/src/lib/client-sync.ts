import { z } from 'zod';

import { parseEncryptedEnvelope, serializeEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';

export type SyncCursor = { workspaceId: string; value: number };
export type SyncQueueEntry = {
  envelope: string;
  attempts: number;
  nextAttemptAt: number;
  status?: 'pending' | 'blocked' | 'conflict';
};
export type SyncState = {
  cursor: SyncCursor;
  queue: SyncQueueEntry[];
  tombstones: string[];
};

export type SyncStateStore = {
  load(): Promise<SyncState | undefined>;
  save(state: SyncState): Promise<void>;
  exclusive?<T>(operation: () => Promise<T>): Promise<T>;
};

export const syncStateSchema = z
  .strictObject({
    cursor: z.strictObject({ workspaceId: z.string().min(1), value: z.number().int().nonnegative() }),
    queue: z
      .array(
        z.strictObject({
          envelope: z
            .string()
            .max(150_000)
            .refine((value) => {
              try {
                const envelope = parseEncryptedEnvelope(JSON.parse(value) as unknown);

                return envelope.kind === 'sync-object' && serializeEncryptedEnvelope(envelope) === value;
              } catch {
                return false;
              }
            }, 'Invalid canonical sync envelope'),
          attempts: z.number().int().nonnegative(),
          nextAttemptAt: z.number().int().nonnegative(),
          status: z.enum(['pending', 'blocked', 'conflict']).optional(),
        }),
      )
      .max(10_000),
    tombstones: z.array(z.string().min(1)).max(100_000),
  })
  .refine((state) => {
    try {
      return state.queue.every(
        (entry) =>
          parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown).workspaceId === state.cursor.workspaceId,
      );
    } catch {
      return false;
    }
  }, 'Sync state workspace mismatch');

export class SyncTransportError extends Error {
  constructor(readonly status: number) {
    super(`Opaque sync request failed with status ${status}.`);
    this.name = 'SyncTransportError';
  }
}

export type OpaqueSyncTransport = {
  append(envelope: EncryptedEnvelope): Promise<{ cursor: number; duplicate: boolean }>;
  list(afterCursor: number): Promise<ReadonlyArray<{ cursor: number; envelope: EncryptedEnvelope }>>;
};

export type OpaqueSyncTransportOptions = {
  baseUrl: string;
  workspaceId: string;
  deviceId: string;
  enrollmentVersion: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

/** Creates the shared HTTP adapter used by both the browser and agent clients. */
export function createOpaqueSyncHttpTransport(options: OpaqueSyncTransportOptions): OpaqueSyncTransport {
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.baseUrl.replace(/\/$/, '')}/sync/${encodeURIComponent(options.workspaceId)}/envelopes`;
  const headers = { 'content-type': 'application/json' };

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(url + path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      headers: { ...headers, ...init?.headers },
    });

    if (!response.ok) throw new SyncTransportError(response.status);

    return response.json() as Promise<unknown>;
  }

  return {
    async append(envelope) {
      const body = await request('', {
        method: 'POST',
        body: JSON.stringify({ deviceId: options.deviceId, enrollmentVersion: options.enrollmentVersion, envelope }),
      });

      return z.object({ data: z.object({ cursor: z.number().int().positive(), duplicate: z.boolean() }) }).parse(body)
        .data;
    },
    async list(afterCursor) {
      const body = await request(
        `?afterCursor=${afterCursor}&limit=100&deviceId=${encodeURIComponent(options.deviceId)}&enrollmentVersion=${options.enrollmentVersion}`,
      );
      const data = z
        .object({
          data: z.object({
            envelopes: z
              .array(
                z.object({
                  cursor: z.number().int().positive(),
                  envelope: z.unknown(),
                }),
              )
              .max(100),
          }),
        })
        .parse(body);

      return data.data.envelopes.map((record) => {
        return { cursor: record.cursor, envelope: parseEncryptedEnvelope(record.envelope) };
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
  // Winner identity includes the entity type. Deleting work must not delete an unrelated planning record with the same ID.
  const active = selected.filter((change) => change.operation === 'upsert');

  return {
    work: active.filter((change) => change.entityType === 'work').sort(compareChange),
    planning: active.filter((change) => change.entityType === 'planning').sort(compareChange),
    progress: active.filter((change) => change.entityType === 'progress').sort(compareChange),
    tombstones,
  };
}

export class MemorySyncStateStore implements SyncStateStore {
  private state: SyncState | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation, operation);

    this.tail = pending.catch(() => undefined);

    return await pending;
  }

  async load(): Promise<SyncState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: SyncState): Promise<void> {
    this.state = syncStateSchema.parse(state);
  }
}

export abstract class ClientSyncAdapter {
  private state: SyncState;
  private tail: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly workspaceId: string,
    private readonly transport: OpaqueSyncTransport,
    private readonly stateStore: SyncStateStore,
    private readonly maxAttempts = 5,
  ) {
    this.state = { cursor: { workspaceId, value: 0 }, queue: [], tombstones: [] };
  }

  async initialize(): Promise<void> {
    await this.exclusive(async () => undefined);
  }

  async enqueue(envelope: EncryptedEnvelope): Promise<void> {
    const parsed = parseEncryptedEnvelope(envelope);

    if (parsed.kind !== 'sync-object' || parsed.workspaceId !== this.workspaceId)
      throw new Error('Envelope workspace mismatch.');
    await this.exclusive(async () => {
      if (this.state.tombstones.includes(parsed.envelopeId)) return;
      const serialized = serializeEncryptedEnvelope(parsed);
      const existing = this.state.queue.find((entry) => {
        const previous = parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown);

        return previous.envelopeId === parsed.envelopeId && previous.revision === parsed.revision;
      });

      if (existing) {
        if (existing.envelope !== serialized)
          throw new Error('Resolve the pending encrypted revision before replacing it.');

        return;
      }

      this.state.queue.push({ envelope: serialized, attempts: 0, nextAttemptAt: 0 });
      await this.persist();
    });
  }

  async flush(now = Date.now()): Promise<{ sent: number; pending: number }> {
    return await this.exclusive(async () => {
      let sent = 0;
      let failure: unknown;

      for (const entry of [...this.state.queue]) {
        if (entry.nextAttemptAt > now || (entry.status && entry.status !== 'pending')) continue;
        try {
          await this.transport.append(parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown));
          this.state.queue = this.state.queue.filter((candidate) => candidate !== entry);
          sent += 1;
        } catch (error: unknown) {
          if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
            failure = error;

            break;
          }
          if (error instanceof SyncTransportError) {
            if (error.status === 401) {
              failure = error;

              break;
            }
            if ([400, 403, 404, 409, 410, 422].includes(error.status)) {
              entry.status = error.status === 409 ? 'conflict' : 'blocked';

              continue;
            }
          }

          entry.attempts += 1;
          entry.nextAttemptAt = now + 2 ** Math.min(entry.attempts, 10) * 1000;
          if (entry.attempts >= this.maxAttempts) {
            failure = error;
          }
        }
      }
      await this.persist();
      if (failure) throw new SyncOfflineError(failure);

      return { sent, pending: this.state.queue.length };
    });
  }

  /** Explicit user reconciliation only; conflicts are never silently replayed. */
  async discard(envelopeId: string, revision: number): Promise<void> {
    await this.exclusive(async () => {
      this.state.queue = this.state.queue.filter((entry) => {
        const envelope = parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown);

        return envelope.envelopeId !== envelopeId || envelope.revision !== revision;
      });
      await this.persist();
    });
  }

  /** Apply durably and idempotently before acknowledging the cursor; failures replay the batch. */
  async pull(
    apply?: (envelopes: ReadonlyArray<EncryptedEnvelope>) => Promise<void>,
  ): Promise<ReadonlyArray<EncryptedEnvelope>> {
    return await this.exclusive(async () => {
      let records: ReadonlyArray<{ cursor: number; envelope: EncryptedEnvelope }>;

      try {
        records = await this.transport.list(this.state.cursor.value);
      } catch (error: unknown) {
        throw new SyncOfflineError(error);
      }
      const accepted: EncryptedEnvelope[] = [];
      const changes: EncryptedEnvelope[] = [];
      const ordered = [...records].sort((left, right) => left.cursor - right.cursor);
      const cursors = new Set<number>();

      for (const record of ordered) {
        const envelope = parseEncryptedEnvelope(record.envelope);

        if (
          !Number.isSafeInteger(record.cursor) ||
          record.cursor < 1 ||
          cursors.has(record.cursor) ||
          envelope.kind !== 'sync-object' ||
          envelope.workspaceId !== this.workspaceId
        ) {
          throw new Error('Invalid opaque sync batch.');
        }
        cursors.add(record.cursor);
      }

      for (const record of ordered) {
        if (record.cursor <= this.state.cursor.value) continue;
        const envelope = parseEncryptedEnvelope(record.envelope);

        if (envelope.metadata['tombstone'] === 'true') {
          changes.push(envelope);
          this.state.tombstones = [...new Set([...this.state.tombstones, envelope.envelopeId])].sort();
          for (const entry of this.state.queue) {
            const queued = parseEncryptedEnvelope(JSON.parse(entry.envelope) as unknown);

            if (queued.envelopeId === envelope.envelopeId) entry.status = 'blocked';
          }
        } else if (!this.state.tombstones.includes(envelope.envelopeId)) {
          changes.push(envelope);
          accepted.push(envelope);
        }
        this.state.cursor = { workspaceId: this.workspaceId, value: record.cursor };
      }
      if (apply) await apply(changes);
      await this.persist();

      return accepted;
    });
  }

  snapshot(): SyncState {
    return structuredClone(this.state);
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(syncStateSchema.parse(this.state));
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async () => {
      const stored = await this.stateStore.load();

      if (stored) {
        const parsed = syncStateSchema.parse(stored);

        if (parsed.cursor.workspaceId !== this.workspaceId) throw new Error('Sync state workspace mismatch.');
        this.state = parsed;
      }

      const before = structuredClone(this.state);

      try {
        return await operation();
      } catch (error: unknown) {
        // A failed pull/save must not leave an uncommitted cursor or queue in memory.
        // Flush can persist successful deliveries before reporting another failure.
        const committed = await this.stateStore.load().catch(() => undefined);

        this.state = committed ? syncStateSchema.parse(committed) : before;

        throw error;
      }
    };

    if (this.stateStore.exclusive) return await this.stateStore.exclusive(execute);
    const pending = this.tail.then(execute, execute);

    this.tail = pending.catch(() => undefined);

    return await pending;
  }
}

export class BrowserSyncAdapter extends ClientSyncAdapter {}
export class AgentSyncAdapter extends ClientSyncAdapter {}
