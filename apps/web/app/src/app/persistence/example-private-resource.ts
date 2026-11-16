import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Service, effect, inject, signal } from '@angular/core';
import { z } from 'zod';
import {
  createPrfCredential,
  deviceCustodyContext,
  encodeBytes,
  IndexedDbReplicaStorage,
  SyncReplica,
  replicaId,
  type DeviceCustody,
} from '@visomi-stack/web-shared-vault';
import {
  createOperationId,
  dataAad,
  deviceChallengeSchema,
  keyDomainSchema,
  syncWriteSchema,
  syntheticHybridPolicy,
  VaultError,
  type DataEnvelope,
  type KeyDomain,
  type WrappingContext,
} from '@visomi-stack/shared-persistence';

import { Session } from '../auth/session/session';

import { PersistenceHttp } from './http';
import { VaultSession } from './vault-session';

export type ExampleTarget = { tenantId: string; scopeId: string; objectId: string };
const rosterSchema = z.object({
  key: keyDomainSchema,
  epoch: z.number().int().positive(),
  phase: z.enum(['ready', 'rotating']),
  devices: z.array(
    z.object({
      id: z.uuid(),
      ownerId: z.uuid(),
      signing: z.string(),
      encryption: z.string(),
      revokedAt: z.string().nullable(),
    }),
  ),
});

/** Synthetic consumer of the common protocol. Its manifest is fixed in code, independent of a cloud response. */
@Service({ autoProvided: false })
export class ExamplePrivateResource {
  private readonly api = inject(PersistenceHttp);
  readonly vault = inject(VaultSession);
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly pending = signal(false);
  readonly synchronized = signal(false);
  readonly conflict = signal(false);

  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.close();
    this.vault.lock();
  });

  private storage: IndexedDbReplicaStorage | undefined;
  private replica: SyncReplica | undefined;
  private custody: DeviceCustody | undefined;
  private binding: WrappingContext | undefined;
  private controller = new AbortController();

  async unlock(target: ExampleTarget, rpId: string, initialize: boolean): Promise<void> {
    this.close();
    const signal = this.controller.signal;
    const view = this.document.defaultView;
    const ownerId = this.session.user()?.id;

    if (!view || !ownerId || !this.session.full()) {
      throw new VaultError('unavailable');
    }

    const path = this.path(target);
    let registry: z.infer<typeof rosterSchema> | undefined;

    try {
      const raw = await this.api.request(`${path}/devices`, undefined, signal);

      registry = rosterSchema.parse(raw);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.error?.error !== 'key_scope_uninitialized') {
        throw error;
      }
    }

    if (registry?.phase === 'rotating') {
      throw new VaultError('unavailable');
    }

    const key: KeyDomain = registry?.key ?? {
      product: syntheticHybridPolicy.product,
      domain: 'private-resources',
      scope: { kind: 'resource', tenantId: target.tenantId, groupId: null, resourceId: target.scopeId },
      generation: 1,
    };

    if (
      key.product !== syntheticHybridPolicy.product ||
      key.domain !== 'private-resources' ||
      key.scope.kind !== 'resource' ||
      key.scope.tenantId !== target.tenantId ||
      key.scope.resourceId !== target.scopeId ||
      key.scope.groupId !== null
    ) {
      throw new VaultError('corrupt');
    }

    const existing = await this.vault.localBinding(key);

    if (!existing && (!initialize || registry)) {
      throw new VaultError('recovery-required');
    }

    let binding = existing;

    if (!binding) {
      const methodId = await createPrfCredential(
        { origin: view.location.origin, rpId, credentials: view.navigator.credentials, crypto: view.crypto },
        AbortSignal.any([signal, this.session.cancellation()]),
      );

      binding = {
        key,
        ownerId,
        deviceId: view.crypto.randomUUID(),
        method: 'passkey-prf',
        methodId,
        origin: view.location.origin,
      };
    }

    await this.vault.connect(binding, rpId, !existing);

    if (signal.aborted) {
      this.vault.lock();

      throw new VaultError('stale-operation');
    }

    const custodyExists = await this.vault.localBinding(deviceCustodyContext(binding).key);

    if (!custodyExists && registry) {
      throw new VaultError('recovery-required');
    }

    const custody = await this.vault.device(binding, rpId, !custodyExists);

    if (signal.aborted) {
      custody.lock();

      throw new VaultError('stale-operation');
    }

    this.custody = custody;
    this.binding = binding;

    if (!registry) {
      const keys = await custody.publicKeys();
      const requested = await this.api.request(`${path}/devices/request`, { deviceId: binding.deviceId, keys }, signal);
      const proof = await custody.prove(deviceChallengeSchema.parse(requested));

      await this.api.request(`${path}/devices/bootstrap`, proof, signal);

      const roster = await this.api.request(`${path}/devices`, undefined, signal);

      registry = rosterSchema.parse(roster);
    }

    const device = registry.devices.find(
      (device) => device.id === binding.deviceId && device.ownerId === ownerId && !device.revokedAt,
    );
    const keys = await custody.publicKeys();

    if (!device || device.signing !== keys.signing || device.encryption !== keys.encryption) {
      this.close();

      throw new VaultError('recovery-required');
    }

    const storage = await IndexedDbReplicaStorage.open(view.indexedDB, ownerId);

    if (signal.aborted) {
      storage.close();

      throw new VaultError('stale-operation');
    }

    this.storage = storage;
    const id = replicaId(ownerId, key, key.scope);
    const replica = new SyncReplica(
      id,
      key,
      key.scope,
      storage,
      {
        pull: (head, signal) => this.api.request(`${path}/sync/pull`, { protocol: 1, head }, signal),
        push: (value, signal) => this.api.request(`${path}/sync/push`, value, signal),
      },
      view.crypto,
      (envelope) => {
        this.validate(envelope);

        return this.vault.readEnvelope(envelope, false);
      },
    );

    this.replica = replica;

    await this.synchronize(target, false);
  }

  async save(target: ExampleTarget, value: string): Promise<void> {
    const { storage, replica, id } = this.active();
    const pending = await storage.pending(id);

    if (pending) {
      throw new VaultError('revision-conflict');
    }

    const prepared = await this.prepare(target, value);

    await replica.enqueue(prepared);

    await this.vault.readEnvelope(prepared.envelope);

    this.pending.set(true);
    this.synchronized.set(false);
  }

  async keepPending(target: ExampleTarget): Promise<void> {
    const { storage, replica, id } = this.active();
    const pending = await storage.pending(id);

    if (!pending || pending.envelope.context.objectId !== target.objectId) {
      throw new VaultError('revision-conflict');
    }

    await this.show(pending.envelope, target);

    const value = this.vault.plaintext();

    await this.pullAll();

    const replacement = await this.prepare(target, value);

    await replica.resolve(pending.operationId, replacement);

    this.conflict.set(false);

    await this.synchronize(target);
  }

  async useSynchronized(target: ExampleTarget): Promise<void> {
    const { storage, replica, id } = this.active();
    const pending = await storage.pending(id);

    if (!pending || pending.envelope.context.objectId !== target.objectId) {
      throw new VaultError('revision-conflict');
    }

    // Network/integrity failures preserve the pending copy until a verified server version is available.
    await this.pullAll();

    await replica.resolve(pending.operationId, null);

    this.conflict.set(false);

    const current = await storage.unit(id, target.objectId);

    if (current && current.context.kind !== 'tombstone') {
      await this.show(current, target);
    } else {
      this.vault.clearDisplay();
    }

    this.pending.set(false);
    this.synchronized.set(true);
  }

  async synchronize(target: ExampleTarget, flush = true): Promise<void> {
    const { storage, replica, id } = this.active();
    const pending = await storage.pending(id);

    this.pending.set(Boolean(pending));

    if (pending && !flush) {
      if (pending.envelope.context.objectId === target.objectId) {
        await this.show(pending.envelope, target);
      }

      return;
    }

    try {
      if (pending) {
        await replica.flush();
      } else {
        await this.pullAll();
      }
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.error : (error as { code?: unknown })?.code;

      if (
        [
          'sync_conflict',
          'revision_conflict',
          'idempotency_conflict',
          'device_state_conflict',
          'operation_expired',
          'revision-conflict',
        ].includes(String(code))
      ) {
        this.conflict.set(true);
      }

      throw error;
    }
    const value = await storage.unit(id, target.objectId);

    if (value && value.context.kind !== 'tombstone') {
      await this.show(value, target);
    } else {
      this.vault.clearDisplay();
    }

    this.pending.set(false);
    this.synchronized.set(true);
    this.conflict.set(false);
  }

  close(): void {
    this.conflict.set(false);
    this.controller.abort();
    this.controller = new AbortController();
    this.replica?.stop();
    this.replica = undefined;
    this.storage?.close();
    this.storage = undefined;
    this.custody?.lock();
    this.custody = undefined;
    this.binding = undefined;
    this.pending.set(false);
    this.synchronized.set(false);
  }

  private async prepare(target: ExampleTarget, value: string) {
    const { storage, binding, custody, view, id } = this.active();
    const version = this.session.operationVersion();
    const pin = await storage.pin(id);
    const previous = await storage.unit(id, target.objectId);
    const envelope = await this.vault.prepare(
      {
        key: binding.key,
        target: binding.key.scope,
        objectId: target.objectId,
        schemaVersion: 1,
        revision: (previous?.context.revision ?? 0) + 1,
        kind: 'record',
        previousCheckpoint: pin.checkpoint,
      },
      value,
    );
    const operationId = createOperationId(view.crypto);
    const body = {
      protocol: 1 as const,
      operationId,
      expectedRevision: envelope.context.revision - 1,
      head: { cursor: pin.cursor, checkpoint: pin.checkpoint },
      envelope,
    };
    const bodyHash = await view.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
    const authorization = await custody.sign({
      key: binding.key,
      deviceId: binding.deviceId,
      operationId,
      epoch: pin.epoch,
      action: 'sync',
      bodyHash: encodeBytes(new Uint8Array(bodyHash)),
    });

    if (version !== this.session.operationVersion() || !this.vault.ready()) {
      throw new VaultError('stale-operation');
    }

    return syncWriteSchema.parse({ ...body, authorization });
  }

  private async pullAll(): Promise<void> {
    const { replica } = this.active();
    let more: boolean;

    do {
      const page = await replica.pull();

      more = page.more;
    } while (more);
  }

  private validate(envelope: DataEnvelope): void {
    if (envelope.context.schemaVersion !== 1 || !['record', 'tombstone'].includes(envelope.context.kind)) {
      throw new VaultError('unsupported-version');
    }

    const binding = this.binding;

    if (
      !binding ||
      dataAad({ ...envelope.context, key: binding.key, target: binding.key.scope }) !== dataAad(envelope.context)
    ) {
      throw new VaultError('corrupt');
    }
  }

  private async show(envelope: DataEnvelope, target: ExampleTarget): Promise<void> {
    this.validate(envelope);

    if (envelope.context.objectId !== target.objectId) {
      throw new VaultError('corrupt');
    }

    await this.vault.readEnvelope(envelope);
  }

  private active() {
    const storage = this.storage;
    const replica = this.replica;
    const binding = this.binding;
    const custody = this.custody;
    const view = this.document.defaultView;

    if (
      !storage ||
      !replica ||
      !binding ||
      !custody ||
      !view ||
      !this.vault.ready() ||
      !this.session.full() ||
      this.session.user()?.id !== binding.ownerId
    ) {
      throw new VaultError('locked');
    }

    return { storage, replica, binding, custody, view, id: replicaId(binding.ownerId, binding.key, binding.key.scope) };
  }

  private path(target: ExampleTarget) {
    return `/tenants/${target.tenantId}/scopes/${target.scopeId}/domains/private-resources`;
  }

  private readonly accountChanged = effect(() => {
    this.session.operationVersion();
    const ready = this.vault.ready();

    if (!this.session.full() || (this.binding && !ready)) {
      this.close();
    }
  });
}
