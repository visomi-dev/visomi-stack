import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import {
  BrowserVault,
  DeviceCustody,
  isVaultPin,
  PinUnlock,
  WebCryptoCipher,
  WebCryptoDevices,
} from '@visomi-stack/web-frontend-db';
import {
  VaultError,
  keyDomainId,
  wrappingAad,
  type DataContext,
  type DataEnvelope,
  type DeliveryBinding,
  type VaultState,
  type VaultUnlock,
  type WrappedKey,
  type WrappingContext,
  type KeyDomain,
} from '@visomi-stack/shared-db';

import { Session } from '../../auth/session/session';
import { ClientDatabase } from '../db/database';

import { custodyId, latestBindings } from './vault-bindings';
import { browserPrfUnlock, devicePrfUnlock } from './local-unlock';
import { watchVaultActivity } from './vault-auto-lock';

/** Browser-only key custody bound to the current cloud account, never an automatic login side effect. */
@Service()
export class VaultSession {
  private readonly session = inject(Session);
  private readonly database = inject(ClientDatabase);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly revision = signal(0);
  private readonly selected = signal<{ id: string; version: number; ownerId: string } | null>(null);
  private readonly phase = signal<VaultState>('locked');
  private readonly cleartext = signal('');
  private readonly catalog = signal<WrappingContext[]>([]);

  private readonly scopes = new Map<string, BrowserVault>();
  private readonly devices = new Map<string, DeviceCustody>();
  private readonly openCustody = computed(() => {
    this.revision();

    return (
      [...this.scopes.values()].some((vault) => vault.state === 'ready') ||
      [...this.devices.values()].some((device) => device.ready)
    );
  });

  private readonly bindings = new Map<string, WrappingContext>();
  private readonly cleanup = this.destroyRef.onDestroy(() => this.dispose());

  private observedVersion = this.session.operationVersion();
  private epoch = 0;
  private locked = new AbortController();
  private removeCancellation: (() => void) | undefined;

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
  readonly knownBindings = computed(() =>
    this.session.full() && this.observedVersion === this.session.operationVersion()
      ? this.catalog().filter((binding) => binding.ownerId === this.session.user()?.id)
      : [],
  );

  isSelected(context: WrappingContext): boolean {
    return this.selected()?.id === keyDomainId(context.ownerId, context.key);
  }

  clearDisplay(): void {
    this.cleartext.set('');
  }

  isOpen(context: WrappingContext): boolean {
    this.revision();
    const id = keyDomainId(context.ownerId, context.key);

    return (
      this.session.full() &&
      context.ownerId === this.session.user()?.id &&
      !this.session.cancellation().aborted &&
      this.observedVersion === this.session.operationVersion() &&
      Boolean(this.bindings.get(id) && wrappingAad(this.bindings.get(id)!) === wrappingAad(context)) &&
      this.scopes.get(id)?.state === 'ready'
    );
  }

  canResume(context: WrappingContext): boolean {
    return this.isOpen(context) && this.devices.get(custodyId(context))?.ready === true;
  }

  resume(context: WrappingContext): boolean {
    if (!this.isOpen(context)) {
      return false;
    }

    this.selected.set({
      id: keyDomainId(context.ownerId, context.key),
      version: this.session.operationVersion(),
      ownerId: context.ownerId,
    });

    this.phase.set('ready');
    this.clearDisplay();

    return true;
  }

  /** Cancel obsolete view work synchronously, keeping only fully unlocked custody in this account session. */
  release(): void {
    this.invalidate();
    this.selected.set(null);
    this.clearDisplay();
    this.phase.set('locked');
    for (const vault of this.scopes.values()) {
      if (vault.state !== 'ready') {
        vault.lock(false);
      }
    }
    for (const device of this.devices.values()) {
      if (!device.ready) {
        device.lock();
      }
    }
  }

  deviceUnlock(binding: WrappingContext, rpId: string, signal: AbortSignal) {
    const session = this.identity(binding.ownerId);
    const cancellation = AbortSignal.any([session.signal, signal, this.locked.signal]);

    return devicePrfUnlock(this.document.defaultView, binding, rpId, cancellation);
  }

  connect(
    context: WrappingContext,
    rpId: string,
    initialize = false,
    pin?: Uint8Array,
    unlock?: VaultUnlock,
    initialKey?: Uint8Array,
  ): Promise<void> {
    return this.openBinding(context, rpId, initialize, pin, (vault) =>
      initialKey && initialize
        ? vault.install(context, initialKey, unlock)
        : initialize
          ? vault.initialize(context, unlock)
          : vault.unlock(context, unlock),
    );
  }

  connectLocalPasskey(context: WrappingContext, rpId: string): Promise<void> {
    return this.openBinding(context, rpId, false, undefined, (vault) => vault.unlockLocalPasskey(context));
  }

  async addLocalPasskey(pin: WrappingContext, rpId: string, methodId: string, signal: AbortSignal) {
    const view = this.document.defaultView;

    if (!view?.isSecureContext || pin.origin !== view.location.origin || !this.isOpen(pin) || !this.isSelected(pin)) {
      throw new VaultError('locked');
    }

    const { vault, session, epoch } = this.active();
    const cancellation = AbortSignal.any([session.signal, signal]);
    const unlock = browserPrfUnlock(view, rpId);
    const binding = await vault.addLocalPasskey(methodId, unlock, cancellation);

    if (!this.current(epoch, session) || signal.aborted) {
      throw new VaultError('stale-operation');
    }

    return binding;
  }

  async deliver(context: WrappingContext, recipient: DeliveryBinding, pin?: Uint8Array) {
    if (!this.isSelected(context) || !this.canResume(context)) {
      throw new VaultError('locked');
    }

    const { vault, session, epoch } = this.active();
    const delivery = await vault.deliver(
      recipient,
      new WebCryptoDevices(this.document.defaultView!.crypto),
      pin ? new PinUnlock(async () => Uint8Array.from(pin)) : undefined,
    );

    if (!this.current(epoch, session)) {
      throw new VaultError('stale-operation');
    }

    return delivery;
  }

  /** Caller has verified the signed delivery with the independently trusted signer. */
  install(
    context: WrappingContext,
    rpId: string,
    raw: Uint8Array,
    pin?: Uint8Array,
    unlock?: VaultUnlock,
  ): Promise<void> {
    return this.openBinding(context, rpId, true, pin, (vault) => vault.install(context, raw, unlock));
  }

  seal(context: DataContext, value: string): Promise<DataEnvelope> {
    return this.encryptText(context, value, true);
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

  prepare(context: DataContext, value: string): Promise<DataEnvelope> {
    return this.encryptText(context, value, false);
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

  localBinding(key: KeyDomain, localPasskey = false): Promise<WrappingContext | undefined> {
    return this.readLocalBinding((storage, ownerId) =>
      localPasskey ? storage.localPasskeys?.get(keyDomainId(ownerId, key)) : storage.getCurrentKey(ownerId, key),
    );
  }

  localLatestBinding(key: Omit<KeyDomain, 'generation'>): Promise<WrappingContext | undefined> {
    return this.readLocalBinding((storage, ownerId) => storage.getLatestKey(ownerId, key));
  }

  async device(
    binding: WrappingContext,
    rpId: string,
    provision: boolean | 'resume' = false,
    pin?: Uint8Array,
    unlock?: VaultUnlock,
  ): Promise<DeviceCustody> {
    const session = this.identity(binding.ownerId);
    const epoch = this.epoch;
    const view = this.document.defaultView;

    if (!view || binding.origin !== view.location.origin || !view.isSecureContext) {
      throw new VaultError('unavailable');
    }

    this.bindCancellation(session.signal);
    const id = custodyId(binding);

    const verifyPin = provision === 'resume' && binding.method === 'pin-argon2id';

    if (provision !== true && !verifyPin && this.devices.get(id)?.ready) {
      return this.devices.get(id)!;
    }

    if (binding.method === 'pin-argon2id') {
      if (!pin || !isVaultPin(pin)) {
        throw new VaultError('pin-invalid');
      }

      this.devices.get(id)?.close();
      this.devices.delete(id);
    }

    let device = this.devices.get(id);

    if (!device) {
      const storage = await this.database.vault(binding.ownerId, session.signal);

      if (!this.current(epoch, session)) {
        storage.close();

        throw new VaultError('stale-operation');
      }

      const created = new DeviceCustody(
        storage,
        binding,
        binding.method === 'pin-argon2id'
          ? new PinUnlock(async () => Uint8Array.from(pin!))
          : browserPrfUnlock(view, rpId),
        view.crypto,
      );

      device = created;
      this.devices.set(id, device);
    }

    await device.unlock(provision, unlock);

    if (!this.current(epoch, session)) {
      throw new VaultError('stale-operation');
    }

    this.revision.update((value) => value + 1);

    return device;
  }

  /** Failed local unlock affects only this binding; explicit lock/logout still closes every scope. */
  lockContext(context: WrappingContext): void {
    const id = keyDomainId(context.ownerId, context.key);
    const binding = this.bindings.get(id);

    if (binding && wrappingAad(binding) !== wrappingAad(context)) {
      return;
    }

    this.invalidate();
    this.clearDisplay();

    if (this.selected()?.id === id) {
      this.selected.set(null);
      this.phase.set('locked');
    }

    this.scopes.get(id)?.lock(false);
    this.devices.get(custodyId(context))?.lock();
    this.revision.update((value) => value + 1);
  }

  lock(broadcast = true): void {
    this.invalidate();
    this.cleartext.set('');
    this.phase.set('locked');
    for (const vault of this.scopes.values()) {
      vault.lock(broadcast);
    }
    for (const device of this.devices.values()) {
      device.lock();
    }
  }

  private async encryptText(context: DataContext, value: string, store: boolean): Promise<DataEnvelope> {
    const current = this.active();
    const bytes = new TextEncoder().encode(value);

    try {
      const operation = store ? current.vault.seal(context, bytes) : current.vault.encrypt(context, bytes);
      const envelope = await operation;

      if (!this.current(current.epoch, current.session)) {
        throw new VaultError('stale-operation');
      }

      return envelope;
    } finally {
      bytes.fill(0);
    }
  }

  private async readLocalBinding(
    read: (
      storage: Awaited<ReturnType<ClientDatabase['vault']>>,
      ownerId: string,
    ) => Promise<WrappedKey | undefined> | undefined,
  ): Promise<WrappingContext | undefined> {
    const ownerId = this.session.user()?.id;

    if (!ownerId) {
      throw new VaultError('locked');
    }

    const session = this.identity(ownerId);

    if (!this.document.defaultView) {
      throw new VaultError('unavailable');
    }

    const epoch = this.epoch;
    const storage = await this.database.vault(ownerId, session.signal);

    try {
      const wrapped = await read(storage, ownerId);

      if (!this.current(epoch, session)) {
        throw new VaultError('stale-operation');
      }

      return wrapped?.context;
    } finally {
      storage.close();
    }
  }

  private async openBinding(
    context: WrappingContext,
    rpId: string,
    initialize: boolean,
    pin: Uint8Array | undefined,
    open: (vault: BrowserVault) => Promise<void>,
  ): Promise<void> {
    const session = this.identity(context.ownerId);
    const epoch = this.epoch;
    const view = this.document.defaultView;

    if (
      !view ||
      !['passkey-prf', 'pin-argon2id'].includes(context.method) ||
      context.origin !== view.location.origin ||
      !view.isSecureContext
    ) {
      throw new VaultError('unavailable');
    }

    if (!initialize && this.resume(context)) {
      return;
    }

    this.bindCancellation(session.signal);
    const id = keyDomainId(context.ownerId, context.key);

    if (context.method === 'pin-argon2id' && (!pin || !isVaultPin(pin))) {
      throw new VaultError('pin-invalid');
    }

    if (context.method === 'pin-argon2id' || this.bindings.get(id)?.method !== context.method) {
      this.scopes.get(id)?.close(false);
      this.scopes.delete(id);
    }

    let vault = this.scopes.get(id);

    if (!vault) {
      const storage = await this.database.vault(context.ownerId, session.signal);

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
        context.method === 'pin-argon2id'
          ? new PinUnlock(async () => Uint8Array.from(pin!))
          : browserPrfUnlock(view, rpId),
        new WebCryptoCipher(view.crypto),
        (state) => {
          if (this.scopes.get(id) !== created) {
            return;
          }

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

    this.bindings.set(id, context);
    this.selected.set({ id, version: session.version, ownerId: context.ownerId });
    this.cleartext.set('');

    await open(vault);

    if (!this.current(epoch, session)) {
      // lock/dispose already invalidated the SDK operation. Do not lock a newer unlock of this cached instance.
      throw new VaultError('stale-operation');
    }

    this.catalog.update((current) => latestBindings(current, [context]));
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

  private invalidate(): void {
    this.locked.abort();
    this.locked = new AbortController();
    this.epoch++;
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
    this.bindings.clear();
    this.catalog.set([]);
    for (const device of this.devices.values()) {
      device.close();
    }
    this.devices.clear();
    this.removeCancellation?.();
    this.removeCancellation = undefined;
    this.selected.set(null);
  }

  private readonly idleLock = effect((cleanup) => {
    if (this.openCustody()) {
      cleanup(watchVaultActivity(this.document, () => this.lock(false)));
    }
  });

  private readonly sessionChanged = effect(() => {
    const version = this.session.operationVersion();
    const full = this.session.full();

    if (version !== this.observedVersion || !full) {
      this.observedVersion = version;
      this.dispose();
    }
  });
}
