import {
  CryptoContractError,
  dataAad,
  scopeTuple,
  syncCheckpointMessage,
  syncPageSchema,
  syncWriteSchema,
  type CryptoScope,
  type DataEnvelope,
  type KeyDomain,
  type SyncEvent,
  type SyncHead,
  type SyncPage,
} from '@visomi-stack/shared-persistence';

import { encodeBytes } from './crypto';

export type ReplicaPin = SyncHead & { generation: number; epoch: number };
export type PendingWrite = ReturnType<typeof syncWriteSchema.parse>;
export type ReplicaStorage = {
  pin(id: string): Promise<ReplicaPin>;
  commit(id: string, expected: ReplicaPin, next: ReplicaPin, events: readonly SyncEvent[]): Promise<void>;
  unit(id: string, objectId: string): Promise<DataEnvelope | undefined>;
  enqueue(id: string, value: PendingWrite): Promise<void>;
  pending(id: string): Promise<PendingWrite | undefined>;
  /** Delete only after commit observed the exact pending envelope in authenticated history. */
  acknowledged(id: string, operationId: string): Promise<void>;
  /** Explicit domain/user decision: replace or discard this exact operation. Retry logic never calls this. */
  resolve(id: string, operationId: string, replacement: PendingWrite | null): Promise<void>;
};
export type ReplicaTransport = {
  pull(head: SyncHead, signal: AbortSignal): Promise<unknown>;
  push(value: PendingWrite, signal: AbortSignal): Promise<unknown>;
};

/** One stream per instance. Domain merge/rebase is explicit; conflicts preserve the encrypted outbox. */
export class SyncReplica {
  private epoch = 0;
  private controller = new AbortController();

  constructor(
    private readonly id: string,
    private readonly key: Omit<KeyDomain, 'generation'>,
    private readonly target: CryptoScope,
    private readonly store: ReplicaStorage,
    private readonly transport: ReplicaTransport,
    private readonly crypto: Crypto,
    private readonly authenticate: (envelope: DataEnvelope) => Promise<void>,
  ) {}

  async pull(): Promise<SyncPage> {
    const epoch = this.epoch;
    const pin = await this.store.pin(this.id);

    this.current(epoch);
    const raw = await this.transport.pull({ cursor: pin.cursor, checkpoint: pin.checkpoint }, this.controller.signal);

    this.current(epoch);
    const result = syncPageSchema.safeParse(raw);

    if (!result.success) {
      throw new CryptoContractError('malformed');
    }

    const page = result.data;

    if (page.generation < pin.generation || page.epoch < pin.epoch || page.head.cursor < pin.cursor) {
      throw new CryptoContractError('context-mismatch');
    }

    let cursor = pin.cursor;
    let checkpoint = pin.checkpoint;

    for (const event of page.events) {
      if (
        event.cursor !== cursor + 1 ||
        event.previousCheckpoint !== checkpoint ||
        event.envelope.context.previousCheckpoint !== checkpoint ||
        event.envelope.context.key.generation > page.generation
      ) {
        throw new CryptoContractError('context-mismatch');
      }

      const expected = {
        ...event.envelope.context,
        key: { ...this.key, generation: event.envelope.context.key.generation },
        target: this.target,
      };

      if (dataAad(expected) !== dataAad(event.envelope.context)) {
        throw new CryptoContractError('context-mismatch');
      }

      const digest = await this.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(syncCheckpointMessage(event.cursor, checkpoint, event.envelope)),
      );

      if (encodeBytes(new Uint8Array(digest)) !== event.checkpoint) {
        throw new CryptoContractError('integrity-failure');
      }

      // The callback must authenticate AEAD under the expected generation and clear any transient plaintext.
      await this.authenticate(event.envelope);

      this.current(epoch);
      cursor = event.cursor;
      checkpoint = event.checkpoint;
    }

    if (
      cursor > page.head.cursor ||
      page.more !== cursor < page.head.cursor ||
      (!page.more && checkpoint !== page.head.checkpoint) ||
      (page.more && page.events.length === 0)
    ) {
      throw new CryptoContractError('context-mismatch');
    }

    await this.store.commit(
      this.id,
      pin,
      { cursor, checkpoint, generation: page.generation, epoch: page.epoch },
      page.events,
    );

    this.current(epoch);

    return page;
  }

  async enqueue(input: PendingWrite): Promise<void> {
    const value = syncWriteSchema.safeParse(input);

    if (!value.success) {
      throw new CryptoContractError('malformed');
    }

    const expected = {
      ...value.data.envelope.context,
      key: { ...this.key, generation: value.data.envelope.context.key.generation },
      target: this.target,
    };

    if (dataAad(expected) !== dataAad(value.data.envelope.context)) {
      throw new CryptoContractError('context-mismatch');
    }

    await this.store.enqueue(this.id, value.data);
  }

  async flush(): Promise<void> {
    const epoch = this.epoch;
    const pending = await this.store.pending(this.id);

    this.current(epoch);

    if (!pending) {
      return;
    }

    // Ack loss retries identical bytes. Conflicts/offline/rotation leave the outbox intact for explicit client rebase.
    await this.transport.push(pending, this.controller.signal);

    this.current(epoch);
    // Pull and authenticate committed history before dropping the only pending copy.
    let page: SyncPage;

    do {
      const result = await this.pull();

      page = result;
    } while (page.more);
    this.current(epoch);

    await this.store.acknowledged(this.id, pending.operationId);

    this.current(epoch);
  }

  async resolve(operationId: string, replacement: PendingWrite | null): Promise<void> {
    if (replacement) {
      const value = syncWriteSchema.safeParse(replacement);

      if (!value.success) {
        throw new CryptoContractError('malformed');
      }

      const expected = {
        ...value.data.envelope.context,
        key: { ...this.key, generation: value.data.envelope.context.key.generation },
        target: this.target,
      };

      if (dataAad(expected) !== dataAad(value.data.envelope.context)) {
        throw new CryptoContractError('context-mismatch');
      }

      await this.store.resolve(this.id, operationId, value.data);
    } else {
      await this.store.resolve(this.id, operationId, null);
    }
  }

  stop(): void {
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
  }

  private current(epoch: number) {
    if (epoch !== this.epoch) {
      throw new CryptoContractError('context-mismatch');
    }
  }
}

export const replicaId = (ownerId: string, key: Omit<KeyDomain, 'generation'>, target: CryptoScope) =>
  JSON.stringify([ownerId, key.product, key.domain, scopeTuple(key.scope), scopeTuple(target)]);
