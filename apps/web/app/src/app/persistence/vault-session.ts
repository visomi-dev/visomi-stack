import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import {
  BrowserVault,
  DeviceCustody,
  IndexedDbVaultStorage,
  PrfUnlock,
  WebCryptoCipher,
} from '@visomi-stack/web-shared-vault';
import {
  VaultError,
  keyDomainId,
  type DataContext,
  type DataEnvelope,
  type VaultState,
  type WrappingContext,
  type KeyDomain,
} from '@visomi-stack/shared-persistence';

import { Session } from '../auth/session/session';

/** Browser-only key custody bound to the current cloud account, never an automatic login side effect. */
@Service()
export class VaultSession {
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly revision = signal(0);
  private readonly selected = signal<{ id: string; version: number; ownerId: string } | null>(null);
  private readonly phase = signal<VaultState>('locked');
  private readonly cleartext = signal('');

  readonly state = computed<VaultState>(() => {
    const selection = this.selected();

    this.revision();

    return selection &&
      this.session.full() &&
      selection.ownerId === this.session.user()?.id &&
      selection.version === this.session.operationVersion()
      ? this.phase()
      : 'locked';
  });
  readonly ready = computed(() => this.state() === 'ready');
  readonly plaintext = computed(() => (this.ready() ? this.cleartext() : ''));

  private readonly scopes = new Map<string, BrowserVault>();
  private readonly devices = new Map<string, DeviceCustody>();
  private readonly cleanup = this.destroyRef.onDestroy(() => this.dispose());

  private observedVersion = this.session.operationVersion();
  private epoch = 0;
  private removeCancellation: (() => void) | undefined;

  isSelected(context: WrappingContext): boolean {
    return this.selected()?.id === keyDomainId(context.ownerId, context.key);
  }

  clearDisplay(): void {
    this.cleartext.set('');
  }

  async connect(context: WrappingContext, rpId: string, initialize = false): Promise<void> {
    const session = this.identity(context.ownerId);
    const epoch = this.epoch;
    const view = this.document.defaultView;

    if (!view || context.method !== 'passkey-prf' || context.origin !== view.location.origin || !view.isSecureContext) {
      throw new VaultError('unavailable');
    }

    this.bindCancellation(session.signal);
    const id = keyDomainId(context.ownerId, context.key);
    let vault = this.scopes.get(id);

    if (!vault) {
      const storage = await IndexedDbVaultStorage.open(view.indexedDB, context.ownerId);

      if (!this.current(epoch, session)) {
        storage.close();

        throw new VaultError('stale-operation');
      }

      let channel: BroadcastChannel | undefined;

      try {
        channel = new BroadcastChannel(`visomi-vault-lock:${context.ownerId}`);
        channel.addEventListener('message', this.lockNotice);
      } catch {
        /* Explicit lock still works if cross-tab channels are unavailable. */
      }
      const created = new BrowserVault(
        context.ownerId,
        storage,
        new PrfUnlock({
          origin: view.location.origin,
          rpId,
          credentials: view.navigator.credentials,
          crypto: view.crypto,
        }),
        new WebCryptoCipher(view.crypto),
        (state) => {
          this.cleartext.set('');

          if (this.selected()?.id === id) {
            this.phase.set(state);
          }

          this.revision.update((value) => value + 1);
        },
        channel,
      );

      vault = created;
      this.scopes.set(id, vault);
    }

    this.selected.set({ id, version: session.version, ownerId: context.ownerId });
    this.cleartext.set('');

    if (initialize) {
      await vault.initialize(context);
    } else {
      await vault.unlock(context);
    }

    if (!this.current(epoch, session)) {
      vault.lock();

      throw new VaultError('stale-operation');
    }
  }

  async seal(context: DataContext, value: string): Promise<DataEnvelope> {
    const current = this.active();
    const bytes = new TextEncoder().encode(value);

    try {
      const envelope = await current.vault.seal(context, bytes);

      if (!this.current(current.epoch, current.session)) {
        throw new VaultError('stale-operation');
      }

      return envelope;
    } finally {
      bytes.fill(0);
    }
  }

  async read(context: DataContext): Promise<void> {
    const current = this.active();
    const bytes = await current.vault.open(context);

    try {
      if (!this.current(current.epoch, current.session)) {
        throw new VaultError('stale-operation');
      }

      this.cleartext.set(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  }

  async prepare(context: DataContext, value: string): Promise<DataEnvelope> {
    const current = this.active();
    const bytes = new TextEncoder().encode(value);

    try {
      const envelope = await current.vault.encrypt(context, bytes);

      if (!this.current(current.epoch, current.session)) {
        throw new VaultError('stale-operation');
      }

      return envelope;
    } finally {
      bytes.fill(0);
    }
  }

  async readEnvelope(envelope: DataEnvelope, display = true): Promise<void> {
    const current = this.active();
    const clear = await current.vault.decrypt(envelope.context, envelope);

    try {
      if (!this.current(current.epoch, current.session)) {
        throw new VaultError('stale-operation');
      }

      if (display) {
        this.cleartext.set(new TextDecoder('utf-8', { fatal: true }).decode(clear));
      }
    } finally {
      clear.fill(0);
    }
  }

  async localBinding(key: KeyDomain): Promise<WrappingContext | undefined> {
    const ownerId = this.session.user()?.id;

    if (!ownerId) {
      throw new VaultError('locked');
    }

    const session = this.identity(ownerId);
    const epoch = this.epoch;
    const view = this.document.defaultView;

    if (!view) {
      throw new VaultError('unavailable');
    }

    const storage = await IndexedDbVaultStorage.open(view.indexedDB, ownerId);

    try {
      const wrapped = await storage.getCurrentKey(ownerId, key);

      if (!this.current(epoch, session)) {
        throw new VaultError('stale-operation');
      }

      return wrapped?.context;
    } finally {
      storage.close();
    }
  }

  async device(binding: WrappingContext, rpId: string, provision = false): Promise<DeviceCustody> {
    const session = this.identity(binding.ownerId);
    const epoch = this.epoch;
    const view = this.document.defaultView;

    if (!view || binding.origin !== view.location.origin || !view.isSecureContext) {
      throw new VaultError('unavailable');
    }

    this.bindCancellation(session.signal);
    const id = JSON.stringify([
      binding.ownerId,
      binding.key.product,
      binding.key.scope.tenantId,
      binding.deviceId,
      binding.methodId,
      binding.origin,
    ]);
    let device = this.devices.get(id);

    if (!device) {
      const storage = await IndexedDbVaultStorage.open(view.indexedDB, binding.ownerId);

      if (!this.current(epoch, session)) {
        storage.close();

        throw new VaultError('stale-operation');
      }

      const created = new DeviceCustody(
        storage,
        binding,
        new PrfUnlock({
          origin: view.location.origin,
          rpId,
          credentials: view.navigator.credentials,
          crypto: view.crypto,
        }),
        view.crypto,
      );

      device = created;
      this.devices.set(id, device);
    }

    await device.unlock(provision);

    if (!this.current(epoch, session)) {
      device.lock();

      throw new VaultError('stale-operation');
    }

    return device;
  }

  lock(broadcast = true): void {
    this.epoch++;
    this.cleartext.set('');
    this.phase.set('locked');
    for (const vault of this.scopes.values()) {
      vault.lock(broadcast);
    }
    for (const device of this.devices.values()) {
      device.lock();
    }
  }

  private identity(ownerId: string) {
    if (!this.session.full() || this.session.user()?.id !== ownerId || this.session.cancellation().aborted) {
      this.lock();

      throw new VaultError('locked');
    }

    return { ownerId, version: this.session.operationVersion(), signal: this.session.cancellation() };
  }

  private readonly lockNotice = (event: MessageEvent<unknown>) => {
    if (event.data === 'lock') {
      this.lock(false);
    }
  };

  private active() {
    const selected = this.selected();

    if (!selected || this.state() !== 'ready') {
      throw new VaultError('locked');
    }

    const session = this.identity(selected.ownerId);
    const vault = this.scopes.get(selected.id);

    if (!vault || session.version !== selected.version) {
      this.lock();

      throw new VaultError('locked');
    }

    return { vault, session, epoch: this.epoch };
  }

  private current(epoch: number, session: { ownerId: string; version: number; signal: AbortSignal }): boolean {
    return (
      epoch === this.epoch &&
      !session.signal.aborted &&
      this.session.full() &&
      session.ownerId === this.session.user()?.id &&
      session.version === this.session.operationVersion()
    );
  }

  private bindCancellation(signal: AbortSignal): void {
    this.removeCancellation?.();
    const cancel = () => this.dispose();

    signal.addEventListener('abort', cancel, { once: true });
    this.removeCancellation = () => signal.removeEventListener('abort', cancel);
  }

  private dispose(): void {
    this.lock();
    for (const vault of this.scopes.values()) {
      vault.close();
    }
    this.scopes.clear();
    for (const device of this.devices.values()) {
      device.close();
    }
    this.devices.clear();
    this.removeCancellation?.();
    this.removeCancellation = undefined;
    this.selected.set(null);
  }

  private readonly sessionChanged = effect(() => {
    const version = this.session.operationVersion();
    const full = this.session.full();

    if (version !== this.observedVersion || !full) {
      this.observedVersion = version;
      this.dispose();
    }
  });
}
