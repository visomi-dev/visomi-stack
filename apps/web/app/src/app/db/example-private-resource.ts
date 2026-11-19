import type { IndexedDbReplicaStorage } from '@visomi-stack/web-frontend-db/storage';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Service, effect, inject, signal } from '@angular/core';
import type { z } from 'zod';
import {
  createPrfCredential,
  createPinMethodId,
  deviceCustodyContext,
  encodeBytes,
  SyncReplica,
  replicaId,
  type DeviceCustody,
} from '@visomi-stack/web-frontend-db';
import {
  createOperationId,
  deviceChallengeSchema,
  syncWriteSchema,
  syntheticHybridPolicy,
  VaultError,
  type DataEnvelope,
  type KeyDomain,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';
import { DatabaseHttp } from '../shared/db/http';
import { ClientDatabase } from '../shared/db/database';
import { VaultSession } from '../shared/vault/vault-session';
import { openLocalVault } from '../shared/vault/local-unlock';

import { rosterSchema, validateExampleEnvelope, exampleLocalKey, examplePrivatePath } from './example-contracts';
import type { ExampleTarget } from './example-contracts';

export type { ExampleTarget } from './example-contracts';

/** Synthetic consumer of the common protocol. Its manifest is fixed in code, independent of a cloud response. */
@Service({ autoProvided: false })
export class ExamplePrivateResource {
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly pendingState = signal(false);
  private readonly synchronizedState = signal(false);
  private readonly conflictState = signal(false);

  readonly vault = inject(VaultSession);
  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.close();
    this.vault.release();
  });

  private storage: IndexedDbReplicaStorage | undefined;
  private replica: SyncReplica | undefined;
  private custody: DeviceCustody | undefined;
  private binding: WrappingContext | undefined;
  private controller = new AbortController();
  private target: ExampleTarget | undefined;
  private version = 0;

  readonly pending = this.pendingState.asReadonly();
  readonly synchronized = this.synchronizedState.asReadonly();
  readonly conflict = this.conflictState.asReadonly();

  async unlock(target: ExampleTarget, rpId: string, initialize: boolean, pin?: Uint8Array, localOnly = false) {
    this.close();
    this.vault.release();
    const signal = this.controller.signal;

    this.target = { ...target };
    this.version = this.session.operationVersion();
    const view = this.document.defaultView;
    const ownerId = this.session.user()?.id;

    if (!view || !ownerId || !this.session.full()) {
      throw new VaultError('unavailable');
    }

    const path = examplePrivatePath(target);
    let registry: z.infer<typeof rosterSchema> | undefined;

    if ((pin || localOnly) && !initialize) {
      await this.restoreLocal(target, rpId, pin, ownerId, signal, localOnly);

      return;
    }

    try {
      const raw = await this.api.request(`${path}/devices`, undefined, signal);

      this.current(signal);
      registry = rosterSchema.parse(raw);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.error?.error !== 'key_scope_uninitialized') {
        throw error;
      }
    }

    this.current(signal);

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

    this.current(signal);

    if (!existing && (!initialize || registry)) {
      throw new VaultError('recovery-required');
    }

    let binding = existing;

    if (!binding) {
      const method = pin
        ? createPinMethodId(view.crypto)
        : createPrfCredential(
            { origin: view.location.origin, rpId, credentials: view.navigator.credentials, crypto: view.crypto },
            AbortSignal.any([signal, this.session.cancellation()]),
          );
      const methodId = await method;

      this.current(signal);
      binding = {
        key,
        ownerId,
        deviceId: view.crypto.randomUUID(),
        method: pin ? 'pin-argon2id' : 'passkey-prf',
        methodId,
        origin: view.location.origin,
      };
    }

    if ((binding.method === 'pin-argon2id') !== Boolean(pin)) {
      throw new VaultError(pin ? 'pin-invalid' : 'unsupported-prf');
    }

    await (pin ? this.vault.connect(binding, rpId, !existing, pin) : this.vault.connect(binding, rpId, !existing));

    this.current(signal);

    const custodyExists = await this.vault.localBinding(deviceCustodyContext(binding).key);

    this.current(signal);

    if (!custodyExists && registry) {
      throw new VaultError('recovery-required');
    }

    const custody = await (pin
      ? this.vault.device(binding, rpId, !custodyExists, pin)
      : this.vault.device(binding, rpId, !custodyExists));

    this.current(signal);

    this.custody = custody;
    this.binding = binding;

    if (!registry) {
      const keys = await custody.publicKeys();

      this.current(signal);

      const requested = await this.api.request(`${path}/devices/request`, { deviceId: binding.deviceId, keys }, signal);

      this.current(signal);

      const proof = await custody.prove(deviceChallengeSchema.parse(requested));

      this.current(signal);

      await this.api.request(`${path}/devices/bootstrap`, proof, signal);

      this.current(signal);

      const roster = await this.api.request(`${path}/devices`, undefined, signal);

      this.current(signal);
      registry = rosterSchema.parse(roster);
    }

    const device = registry.devices.find(
      (device) => device.id === binding.deviceId && device.ownerId === ownerId && !device.revokedAt,
    );
    const keys = await custody.publicKeys();

    this.current(signal);

    if (!device || device.signing !== keys.signing || device.encryption !== keys.encryption) {
      this.vault.lockContext(binding);
      this.close();

      throw new VaultError('recovery-required');
    }

    const storage = await this.database.replica(ownerId, signal);

    if (signal.aborted) {
      storage.close();

      throw new VaultError('stale-operation');
    }

    this.storage = storage;
    const id = replicaId(ownerId, key, key.scope);

    await storage.advanceControl(id, { epoch: registry.epoch, generation: key.generation });

    this.current(signal);
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
        this.current(signal);
        validateExampleEnvelope(this.binding, envelope);

        return this.vault.readEnvelope(envelope, false);
      },
      registry.epoch,
    );

    this.replica = replica;

    await this.synchronize(target, false);
  }

  async save(target: ExampleTarget, value: string): Promise<void> {
    const { storage, replica, id, signal } = this.active(target);
    const pending = await storage.pending(id);

    this.current(signal);

    if (pending) {
      throw new VaultError('revision-conflict');
    }

    const prepared = await this.prepare(target, value);

    this.current(signal);

    await replica.enqueue(prepared);

    this.current(signal);

    await this.vault.readEnvelope(prepared.envelope);

    this.current(signal);

    this.pendingState.set(true);
    this.synchronizedState.set(false);
  }

  async keepPending(target: ExampleTarget): Promise<void> {
    const { storage, replica, id, signal } = this.active(target);
    const pending = await storage.pending(id);

    this.current(signal);

    if (!pending || pending.envelope.context.objectId !== target.objectId) {
      throw new VaultError('revision-conflict');
    }

    await this.show(pending.envelope, target);

    this.current(signal);

    const value = this.vault.plaintext();

    await this.pullAll(target);

    this.current(signal);

    const replacement = await this.prepare(target, value);

    this.current(signal);

    await replica.resolve(pending.operationId, replacement);

    this.current(signal);

    this.conflictState.set(false);

    await this.synchronize(target);
  }

  async useSynchronized(target: ExampleTarget): Promise<void> {
    const { storage, replica, id, signal } = this.active(target);
    const pending = await storage.pending(id);

    this.current(signal);

    if (!pending || pending.envelope.context.objectId !== target.objectId) {
      throw new VaultError('revision-conflict');
    }

    // Network/integrity failures preserve the pending copy until a verified server version is available.
    await this.pullAll(target);

    this.current(signal);

    await replica.resolve(pending.operationId, null);

    this.current(signal);

    this.conflictState.set(false);

    const current = await storage.unit(id, target.objectId);

    this.current(signal);

    if (current && current.context.kind !== 'tombstone') {
      await this.show(current, target);
    } else {
      this.vault.clearDisplay();
    }

    this.current(signal);
    this.pendingState.set(false);
    this.synchronizedState.set(true);
  }

  async synchronize(target: ExampleTarget, flush = true): Promise<void> {
    const { storage, replica, id, signal } = this.active(target);
    const pending = await storage.pending(id);

    this.current(signal);

    this.pendingState.set(Boolean(pending));

    if (pending && !flush) {
      if (pending.envelope.context.objectId === target.objectId) {
        await this.show(pending.envelope, target);

        this.current(signal);
      }

      return;
    }

    try {
      if (pending) {
        await replica.flush();

        this.current(signal);
      } else {
        await this.pullAll(target);

        this.current(signal);
      }
    } catch (error) {
      this.current(signal);
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
        this.conflictState.set(true);
      }

      throw error;
    }
    const value = await storage.unit(id, target.objectId);

    this.current(signal);

    if (value && value.context.kind !== 'tombstone') {
      await this.show(value, target);
    } else {
      this.vault.clearDisplay();
    }

    this.current(signal);
    this.pendingState.set(false);
    this.synchronizedState.set(true);
    this.conflictState.set(false);
  }

  close(): void {
    this.conflictState.set(false);
    this.controller.abort();
    this.controller = new AbortController();
    this.replica?.stop();
    this.replica = undefined;
    this.storage?.close();
    this.storage = undefined;
    this.custody = undefined;
    this.binding = undefined;
    this.target = undefined;
    this.pendingState.set(false);
    this.synchronizedState.set(false);
  }

  async resume(target: ExampleTarget, rpId: string): Promise<void> {
    this.close();
    const signal = this.controller.signal;

    this.version = this.session.operationVersion();

    const binding = await this.vault.localLatestBinding(exampleLocalKey(target));

    this.current(signal);

    if (!binding || !this.vault.canResume(binding)) {
      return;
    }

    this.target = { ...target };

    await this.restoreLocal(target, rpId, undefined, binding.ownerId, this.controller.signal);
  }

  /** Explicit local unlock: no roster/network lookup. Server authorization is rechecked by later synchronization. */
  private async restoreLocal(
    target: ExampleTarget,
    rpId: string,
    pin: Uint8Array | undefined,
    ownerId: string,
    signal: AbortSignal,
    allowPasskey = false,
  ): Promise<void> {
    const opened = await openLocalVault({
      vault: this.vault,
      database: this.database,
      key: exampleLocalKey(target),
      rpId,
      pin,
      allowPasskey,
      ownerId,
      signal,
      current: () => this.current(signal),
    });
    const { binding: local, custody, storage, pinned } = opened;

    this.custody = custody;
    this.binding = local;
    this.storage = storage;
    const id = replicaId(ownerId, local.key, local.key.scope);

    const path = examplePrivatePath(target);

    this.replica = new SyncReplica(
      id,
      local.key,
      local.key.scope,
      storage,
      {
        pull: (head, signal) => this.api.request(`${path}/sync/pull`, { protocol: 1, head }, signal),
        push: (value, signal) => this.api.request(`${path}/sync/push`, value, signal),
      },
      this.document.defaultView!.crypto,
      (envelope) => {
        this.current(signal);
        validateExampleEnvelope(this.binding, envelope);

        return this.vault.readEnvelope(envelope, false);
      },
      pinned.epoch,
    );

    const pending = await storage.pending(id);

    this.current(signal);
    const selected =
      pending?.envelope.context.objectId === target.objectId ? pending.envelope : storage.unit(id, target.objectId);
    const envelope = await selected;

    this.current(signal);

    if (envelope && envelope.context.kind !== 'tombstone') {
      await this.show(envelope, target);
    }

    this.current(signal);
    this.pendingState.set(Boolean(pending));
  }

  private async prepare(target: ExampleTarget, value: string) {
    const { storage, binding, custody, view, id, signal } = this.active(target);
    const version = this.session.operationVersion();
    const pin = await storage.pin(id);

    this.current(signal);

    const previous = await storage.unit(id, target.objectId);

    this.current(signal);

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

    this.current(signal);
    const operationId = createOperationId(view.crypto);
    const body = {
      protocol: 1 as const,
      operationId,
      expectedRevision: envelope.context.revision - 1,
      head: { cursor: pin.cursor, checkpoint: pin.checkpoint },
      envelope,
    };
    const bodyHash = await view.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));

    this.current(signal);

    const authorization = await custody.sign({
      key: binding.key,
      deviceId: binding.deviceId,
      operationId,
      epoch: pin.epoch,
      action: 'sync',
      bodyHash: encodeBytes(new Uint8Array(bodyHash)),
    });

    this.current(signal);

    if (version !== this.session.operationVersion() || !this.vault.ready()) {
      throw new VaultError('stale-operation');
    }

    return syncWriteSchema.parse({ ...body, authorization });
  }

  private async pullAll(target: ExampleTarget): Promise<void> {
    const { replica, signal } = this.active(target);
    let more: boolean;

    do {
      const page = await replica.pull();

      this.current(signal);

      more = page.more;
    } while (more);
  }

  private async show(envelope: DataEnvelope, target: ExampleTarget): Promise<void> {
    const { signal } = this.active(target);

    validateExampleEnvelope(this.binding, envelope);

    if (envelope.context.objectId !== target.objectId) {
      throw new VaultError('corrupt');
    }

    await this.vault.readEnvelope(envelope);

    this.current(signal);
  }

  private active(target: ExampleTarget) {
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

    this.current(this.controller.signal);

    if (
      !this.target ||
      target.tenantId !== this.target.tenantId ||
      target.scopeId !== this.target.scopeId ||
      target.objectId !== this.target.objectId
    ) {
      throw new VaultError('stale-operation');
    }

    return {
      storage,
      replica,
      binding,
      custody,
      view,
      signal: this.controller.signal,
      id: replicaId(binding.ownerId, binding.key, binding.key.scope),
    };
  }

  private current(signal: AbortSignal): void {
    if (
      signal.aborted ||
      signal !== this.controller.signal ||
      !this.session.full() ||
      this.session.operationVersion() !== this.version
    ) {
      throw new VaultError('stale-operation');
    }
  }

  private readonly accountChanged = effect(() => {
    this.session.operationVersion();
    const ready = this.vault.ready();

    if (!this.session.full() || (this.binding && !ready)) {
      this.close();
    }
  });
}
