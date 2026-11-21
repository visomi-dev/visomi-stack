import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Service, afterNextRender, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { z } from 'zod';
import { createOperationId, VaultError } from '@visomi-stack/shared-db';
import { isVaultPin } from '@visomi-stack/web-frontend-db';
import type { WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';
import { BrowserRealtimeSession } from '../auth/session/browser-realtime-session';
import { Navigation } from '../shared/navigation';
import { DatabaseHttp } from '../shared/db/http';
import { UnlockCapabilities } from '../shared/vault/unlock-capabilities';
import { vaultMessage } from '../shared/vault/vault-messages';
import { VaultSyncStatus } from '../shared/vault/vault-sync-status';

import { VaultNoteDraft } from './vault-note-draft';
import { ExamplePrivateResource } from './example-private-resource';
import {
  exampleLocalKey,
  exampleRecordsPath,
  examplePrivatePath,
  readExampleTarget,
  scopeSchema,
  cloudSchema,
  readExampleProfile,
  type ExampleTarget,
} from './example-contracts';

/** Route-local orchestration; components only bind state and invoke domain actions. */
@Service({ autoProvided: false })
export class ExampleWorkspace {
  private readonly api = inject(DatabaseHttp);
  private readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navigation = inject(Navigation);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });
  private readonly syncStatus = inject(VaultSyncStatus);

  private readonly rendered = signal(false);
  private readonly configured = signal(false);
  private readonly busyState = signal(false);
  private readonly noticeState = signal('');
  private readonly binding = signal<WrappingContext | null>(null);
  private readonly methodLoaded = signal(false);
  private readonly backedScope = signal<'unknown' | 'empty' | 'enrolled'>('unknown');
  private readonly targetState = signal<ExampleTarget | null>(null);
  private readonly watchCursor = signal<number | null>(null);

  readonly privateResource = inject(ExamplePrivateResource);

  private readonly hasVerifiedHistory = computed(() => this.privateResource.verifiedCursor() !== null);

  readonly backedSample = this.route.snapshot.data['backedSample'] === true;
  private readonly params = this.backedSample
    ? toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap })
    : toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly ownerId = this.session.user()?.id;
  private readonly version = this.session.operationVersion();
  private readonly cloud = signal<z.infer<typeof cloudSchema>['items'][number] | null>(null);

  private removeNavigationCancel: (() => void) | undefined;
  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.removeNavigationCancel?.();
    this.reset();
  });

  private navigationSignal: AbortSignal | undefined;
  private controller = new AbortController();
  private profile: ReturnType<typeof readExampleProfile> | undefined;

  readonly capabilities = inject(UnlockCapabilities);

  readonly objectBackups = signal(false);
  readonly cloudDraft = signal('');
  readonly privateDraft = signal('');
  readonly pinDraft = signal('');
  readonly pinConfirmation = signal('');
  readonly pinSetupSelected = signal(false);

  readonly editor = new VaultNoteDraft(this.document, this.privateResource, this.syncStatus);
  readonly busy = this.busyState.asReadonly();

  readonly editorReadOnly = computed(() => this.busy() || this.editor.readOnly());
  readonly available = computed(
    () =>
      this.configured() &&
      !this.navigation.active() &&
      this.session.full() &&
      this.session.user()?.id === this.ownerId &&
      this.session.operationVersion() === this.version,
  );

  readonly vault = this.privateResource.vault;
  readonly status = computed(() => vaultMessage(this.vault.state()));
  readonly showPin = computed(
    () =>
      this.methodLoaded() &&
      (this.binding()?.method === 'pin-argon2id' || (!this.binding() && this.capabilities.prf() === 'unavailable')),
  );
  readonly showPrf = computed(
    () =>
      this.methodLoaded() &&
      (this.binding()?.method === 'passkey-prf' ||
        (!this.binding() && ['available', 'unknown'].includes(this.capabilities.prf()))),
  );
  readonly hasBinding = computed(() => this.binding() !== null);
  readonly canInitialize = computed(
    () => this.methodLoaded() && !this.hasBinding() && (!this.backedSample || this.backedScope() === 'empty'),
  );
  readonly canPair = computed(() => !this.backedSample || this.hasBinding() || this.backedScope() === 'enrolled');
  readonly loading = computed(() => !this.rendered() || this.busyState());
  readonly pairingParams = computed(() => {
    const target = this.targetState();

    return this.backedSample && target ? { ...target, sample: 'vault-backup' } : target;
  });

  readonly notice = this.noticeState.asReadonly();
  readonly target = this.targetState.asReadonly();

  selectPinSetup(): void {
    if (this.canInitialize() && this.showPin()) {
      this.pinSetupSelected.set(true);
    }
  }

  editOperationalNote(value: string): void {
    this.cloudDraft.set(value);
  }

  editPrivateText(value: string): void {
    if (this.backedSample && (!this.vault.ready() || this.editorReadOnly())) {
      return;
    }

    if (this.backedSample) {
      this.editor.edit(value, () => void this.saveDraft());
    } else {
      this.privateDraft.set(value);
    }
  }

  async createWorkspace(): Promise<void> {
    if (this.backedSample && !this.objectBackups()) {
      return;
    }

    await this.run(async (signal) => {
      const parent = await this.api.vault('/tenants', {}, signal);

      this.current(signal);
      const tenant = scopeSchema.parse(parent);
      const created = await this.api.vault(
        `/tenants/${tenant.tenantId}/scopes/${tenant.scopeId}/children`,
        this.backedSample ? { kind: 'resource', objectBackup: true } : { kind: 'resource' },
        signal,
      );

      this.current(signal);
      const target = scopeSchema.parse(created);
      const objectId = this.document.defaultView!.crypto.randomUUID();

      if (this.backedSample) {
        await this.router.navigate(['/example/vault'], { queryParams: { ...target, objectId } });
      } else {
        await this.router.navigate(['/persistence', target.tenantId, target.scopeId, objectId]);
      }
    });
  }

  async saveCloud(): Promise<void> {
    await this.run(async (signal) => {
      const target = this.requiredTarget();
      const current = this.cloud();
      const shared = {
        operationId: createOperationId(this.document.defaultView!.crypto),
        title: 'Synthetic operations',
        body: this.cloudDraft(),
        audience: 'owner',
      };

      await this.api.vault(
        exampleRecordsPath(target),
        current
          ? { ...shared, kind: 'update', id: current.id, expectedRevision: current.revision }
          : { ...shared, kind: 'create' },
        signal,
      );

      this.current(signal);

      await this.loadCloud(target, signal);

      this.current(signal);
      this.noticeState.set($localize`:@@persistenceCloudSaved:Saved the note. The server can read it.`);
    });
  }

  async unlock(initialize = false): Promise<void> {
    await this.run(async (signal) => {
      if (!this.profile) {
        throw new VaultError('unavailable');
      }

      try {
        const target = this.requiredTarget();

        await (this.backedSample && !initialize
          ? this.privateResource.unlock(target, this.profile.rpId, false, undefined, true)
          : this.privateResource.unlock(target, this.profile.rpId, initialize));
      } catch (error) {
        this.current(signal);

        await this.loadBinding(this.requiredTarget(), signal);

        this.current(signal);

        if (error instanceof VaultError && error.code === 'unsupported-prf') {
          this.capabilities.unavailable();
        }

        throw error;
      }

      this.current(signal);

      await this.loadBinding(this.requiredTarget(), signal);

      if (!initialize) {
        this.checkBackup();
      }
    });
  }

  async unlockWithPin(initialize = false): Promise<void> {
    const value = this.pinDraft();
    const confirmation = this.pinConfirmation();

    this.pinDraft.set('');
    this.pinConfirmation.set('');
    const pin = new TextEncoder().encode(value);

    try {
      await this.run(async (signal) => {
        if (initialize && (!this.showPin() || (this.backedSample && !this.pinSetupSelected()))) {
          throw new VaultError('unsupported-prf');
        }

        if (!isVaultPin(pin) || (initialize && value !== confirmation)) {
          throw new VaultError('pin-invalid');
        }

        if (!this.profile) {
          throw new VaultError('unavailable');
        }

        await this.privateResource.unlock(this.requiredTarget(), this.profile.rpId, initialize, pin);

        this.current(signal);

        await this.loadBinding(this.requiredTarget(), signal);

        if (!initialize) {
          this.checkBackup();
        }
      });
    } finally {
      pin.fill(0);
    }
  }

  async saveDraft(): Promise<void> {
    if (!this.backedSample || this.editor.value() === null || !this.vault.ready() || this.editorReadOnly()) {
      return;
    }

    await this.run((signal) =>
      this.editor.persist(this.requiredTarget(), () => this.current(signal), this.checkBackup),
    );
  }

  async savePrivate(): Promise<void> {
    await this.run(async (signal) => {
      await this.privateResource.save(this.requiredTarget(), this.privateDraft());

      this.current(signal);

      this.privateDraft.set('');
      this.noticeState.set(
        $localize`:@@vaultSaved:The encrypted change is stored on this device. Synchronization is a separate operation.`,
      );
    });
  }

  synchronize(flush = true): Promise<void> {
    return this.runSync((target) => this.privateResource.synchronize(target, flush));
  }

  resolveConflict(keep: boolean): Promise<void> {
    return this.runSync((target) =>
      keep ? this.privateResource.keepPending(target) : this.privateResource.useSynchronized(target),
    );
  }

  lock(): void {
    this.editor.clear();
    this.privateDraft.set('');
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.vault.lock();
    this.privateResource.close();
  }

  private readonly checkBackup = () => {
    if (this.backedSample && this.vault.ready()) {
      this.watchCursor.set(0);
    }
  };

  private runSync(operation: (target: ExampleTarget) => Promise<void>): Promise<void> {
    return this.run((signal) => {
      const target = this.requiredTarget();

      if (!this.backedSample) {
        return operation(target);
      }

      return this.editor.track(
        () => operation(target),
        () => this.current(signal),
        this.checkBackup,
      );
    });
  }

  private requiredTarget() {
    const target = this.target();

    if (!this.available() || !target || !this.session.full()) {
      throw new VaultError('unavailable');
    }

    return target;
  }

  private async loadBinding(target: ExampleTarget, signal: AbortSignal): Promise<void> {
    const binding = await this.vault.localLatestBinding(exampleLocalKey(target));

    this.current(signal);
    this.binding.set(binding ?? null);
    this.methodLoaded.set(true);
  }

  private async canBootstrap(target: ExampleTarget, signal: AbortSignal): Promise<boolean> {
    try {
      await this.api.vault(`${examplePrivatePath(target)}/devices`, undefined, signal);

      return false;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.error?.error === 'key_scope_uninitialized') {
        return true;
      }

      throw error;
    }
  }

  private async loadCloud(target: ExampleTarget, signal: AbortSignal) {
    const raw = await this.api.vault(`${exampleRecordsPath(target)}?limit=1`, undefined, signal);

    this.current(signal);
    const value = cloudSchema.parse(raw).items[0] ?? null;

    this.cloud.set(value);
    this.cloudDraft.set(value?.body ?? '');
  }

  private current(signal: AbortSignal): void {
    if (
      signal.aborted ||
      signal !== this.controller.signal ||
      this.navigationSignal?.aborted ||
      this.navigationSignal !== this.navigation.context().cancellation ||
      this.navigation.active() ||
      !this.session.full() ||
      this.session.operationVersion() !== this.version ||
      this.session.user()?.id !== this.ownerId
    ) {
      throw new VaultError('stale-operation');
    }
  }

  private reset(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.privateResource.close();
    this.vault.release();
    this.binding.set(null);
    this.methodLoaded.set(false);
    this.backedScope.set('unknown');
    this.configured.set(false);
    this.objectBackups.set(false);
    this.profile = undefined;
    this.targetState.set(null);
    this.cloud.set(null);
    this.cloudDraft.set('');
    this.editor.clear();
    this.privateDraft.set('');
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.pinSetupSelected.set(false);
    this.noticeState.set('');
    this.busyState.set(false);

    if (this.backedSample) {
      this.watchCursor.set(null);
      this.syncStatus.show('idle');
    }
  }

  private async run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.busy() || this.navigation.active()) {
      return;
    }

    const signal = this.controller.signal;

    this.busyState.set(true);
    this.noticeState.set('');

    try {
      this.current(signal);

      await work(signal);
    } catch (error) {
      if (signal.aborted || signal !== this.controller.signal) {
        return;
      }

      const code = error instanceof HttpErrorResponse ? error.error?.error : (error as { code?: unknown })?.code;

      if (
        this.backedSample &&
        error instanceof HttpErrorResponse &&
        error.status === 0 &&
        this.privateResource.pending()
      ) {
        return;
      }

      this.noticeState.set(
        this.backedSample && code === 'scope_access_denied'
          ? $localize`:@@vaultBackedSampleDenied:This account doesn’t have access to the backup workspace.`
          : vaultMessage(typeof code === 'string' ? code : 'unavailable'),
      );
    } finally {
      if (signal === this.controller.signal && !signal.aborted) {
        this.busyState.set(false);
      }
    }
  }

  private readonly clearSessionState = effect(() => {
    this.session.operationVersion();

    if (!this.vault.ready()) {
      this.editor.clear();
      this.privateDraft.set('');

      if (this.backedSample) {
        this.syncStatus.show('idle');
      }
    }

    if (
      !this.session.full() ||
      this.session.operationVersion() !== this.version ||
      this.session.user()?.id !== this.ownerId
    ) {
      untracked(() => this.reset());
    }
  });

  private readonly watchBackedVault = effect((onCleanup) => {
    const target = this.target();
    const verified = this.hasVerifiedHistory();

    if (!this.backedSample || !target || !this.available() || !verified || !this.vault.ready()) {
      return;
    }

    const close = this.realtime?.watchVault(
      () => this.privateResource.watchProof(target),
      (cursor) =>
        this.watchCursor.update((pending) => (pending === 0 || cursor === 0 ? 0 : Math.max(pending ?? 0, cursor))),
    );

    onCleanup(() => {
      close?.();
      this.watchCursor.set(null);
    });
  });

  private readonly syncOnVaultHint = effect(() => {
    const hint = this.watchCursor();
    const cursor = this.privateResource.verifiedCursor();

    if (
      hint !== null &&
      this.available() &&
      this.vault.ready() &&
      !this.busy() &&
      (hint === 0 || !this.privateResource.pending()) &&
      !this.privateResource.conflict() &&
      this.editor.value() === null
    ) {
      untracked(() => {
        this.watchCursor.set(null);

        if (hint === 0 || (cursor !== null && hint > cursor)) {
          void this.synchronize(this.privateResource.pending());
        }
      });
    }
  });

  private readonly routeChanged = effect(() => {
    const params = this.params();
    const rendered = this.rendered();
    const navigating = this.navigation.active();
    const context = this.navigation.context();

    untracked(() => {
      this.reset();
      this.removeNavigationCancel?.();
      this.navigationSignal = context.cancellation;
      const cancel = () => this.reset();

      context.cancellation.addEventListener('abort', cancel, { once: true });
      this.removeNavigationCancel = () => context.cancellation.removeEventListener('abort', cancel);

      if (!rendered || navigating || context.cancellation.aborted) {
        return;
      }

      void this.run(async (signal) => {
        const raw = await this.api.vault('/policy', undefined, signal);

        this.current(signal);
        const profile = readExampleProfile(raw, this.document.defaultView?.location.origin);

        if (!this.backedSample && !profile.hybridHarness) {
          return;
        }

        const target = readExampleTarget(params);

        this.profile = profile;
        this.objectBackups.set(profile.objectBackups === true);
        this.targetState.set(target);
        this.configured.set(true);

        if (target) {
          await this.loadBinding(target, signal);

          this.current(signal);

          if (this.backedSample && !this.hasBinding()) {
            const empty = await this.canBootstrap(target, signal);

            this.current(signal);
            this.backedScope.set(empty ? 'empty' : 'enrolled');
          }

          await this.privateResource.resume(target, profile.rpId);

          this.current(signal);

          this.checkBackup();

          if (!this.backedSample) {
            await this.loadCloud(target, signal);
          }
        }
      });
    });
  });

  private readonly initialize = afterNextRender(() => {
    this.rendered.set(true);
    const view = this.document.defaultView;

    if (!this.backedSample || !view) {
      return;
    }

    view.addEventListener('online', this.checkBackup);
    this.destroyRef.onDestroy(() => view.removeEventListener('online', this.checkBackup));
  });
}
