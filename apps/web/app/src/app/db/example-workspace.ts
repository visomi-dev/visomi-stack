import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Service, afterNextRender, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { z } from 'zod';
import { createOperationId, productPolicySchema, syntheticHybridPolicy, VaultError } from '@visomi-stack/shared-db';
import type { WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';
import { Navigation } from '../shared/navigation';

import { DatabaseHttp } from './http';
import { ExamplePrivateResource, type ExampleTarget } from './example-private-resource';
import { UnlockCapabilities } from './unlock-capabilities';
import { exampleLocalKey } from './example-contracts';
import { vaultMessage } from './vault-messages';

const targetSchema = z.strictObject({ tenantId: z.uuid(), scopeId: z.uuid(), objectId: z.uuid() });
const scopeSchema = targetSchema.omit({ objectId: true });
const cloudSchema = z.object({
  items: z.array(
    z.object({ id: z.uuid(), title: z.string(), body: z.string(), revision: z.number().int().positive() }),
  ),
});
const profileSchema = z.strictObject({
  policy: productPolicySchema,
  origin: z.url(),
  rpId: z.string().min(1).max(253),
});

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

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly rendered = signal(false);
  private readonly configured = signal(false);
  private readonly busyState = signal(false);
  private readonly noticeState = signal('');
  private readonly binding = signal<WrappingContext | null>(null);
  private readonly methodLoaded = signal(false);
  private readonly targetState = signal<ExampleTarget | null>(null);

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
  private profile: z.infer<typeof profileSchema> | undefined;

  readonly capabilities = inject(UnlockCapabilities);
  readonly privateResource = inject(ExamplePrivateResource);

  readonly cloudDraft = signal('');
  readonly privateDraft = signal('');
  readonly pinDraft = signal('');
  readonly pinConfirmation = signal('');

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
  readonly canInitialize = computed(() => this.methodLoaded() && !this.binding());

  readonly busy = this.busyState.asReadonly();
  readonly notice = this.noticeState.asReadonly();
  readonly target = this.targetState.asReadonly();

  async createWorkspace(): Promise<void> {
    await this.run(async (signal) => {
      const parent = await this.api.request('/tenants', {}, signal);

      this.current(signal);
      const tenant = scopeSchema.parse(parent);
      const created = await this.api.request(
        `/tenants/${tenant.tenantId}/scopes/${tenant.scopeId}/children`,
        { kind: 'resource' },
        signal,
      );

      this.current(signal);
      const target = scopeSchema.parse(created);
      const objectId = this.document.defaultView!.crypto.randomUUID();

      await this.router.navigate(['/persistence', target.tenantId, target.scopeId, objectId]);
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

      await this.api.request(
        this.records(target),
        current
          ? { ...shared, kind: 'update', id: current.id, expectedRevision: current.revision }
          : { ...shared, kind: 'create' },
        signal,
      );

      this.current(signal);

      await this.loadCloud(target, signal);

      this.current(signal);
      this.noticeState.set(
        $localize`:@@persistenceCloudSaved:Operational content was saved to the server-readable domain.`,
      );
    });
  }

  async unlock(initialize = false): Promise<void> {
    await this.run(async (signal) => {
      if (!this.profile) {
        throw new VaultError('unavailable');
      }

      try {
        await this.privateResource.unlock(this.requiredTarget(), this.profile.rpId, initialize);
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
        if (initialize && !this.showPin()) {
          throw new VaultError('unsupported-prf');
        }

        if (!/^[0-9]{4,6}$/.test(value) || (initialize && value !== confirmation)) {
          throw new VaultError('pin-invalid');
        }

        if (!this.profile) {
          throw new VaultError('unavailable');
        }

        await this.privateResource.unlock(this.requiredTarget(), this.profile.rpId, initialize, pin);

        this.current(signal);

        await this.loadBinding(this.requiredTarget(), signal);
      });
    } finally {
      pin.fill(0);
    }
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

  async synchronize(): Promise<void> {
    await this.run(() => this.privateResource.synchronize(this.requiredTarget()));
  }

  async keepPending(): Promise<void> {
    await this.run(() => this.privateResource.keepPending(this.requiredTarget()));
  }

  async useSynchronized(): Promise<void> {
    await this.run(() => this.privateResource.useSynchronized(this.requiredTarget()));
  }

  lock(): void {
    this.privateDraft.set('');
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.vault.lock();
    this.privateResource.close();
  }

  private records(target: ExampleTarget) {
    return `/tenants/${target.tenantId}/scopes/${target.scopeId}/domains/operations/records`;
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

  private async loadCloud(target: ExampleTarget, signal: AbortSignal) {
    const raw = await this.api.request(`${this.records(target)}?limit=1`, undefined, signal);

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
    this.configured.set(false);
    this.profile = undefined;
    this.targetState.set(null);
    this.cloud.set(null);
    this.cloudDraft.set('');
    this.privateDraft.set('');
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.noticeState.set('');
    this.busyState.set(false);
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

      this.noticeState.set(vaultMessage(typeof code === 'string' ? code : 'unavailable'));
    } finally {
      if (signal === this.controller.signal && !signal.aborted) {
        this.busyState.set(false);
      }
    }
  }

  private readonly clearSessionState = effect(() => {
    this.session.operationVersion();

    if (!this.vault.ready()) {
      this.privateDraft.set('');
    }

    if (
      !this.session.full() ||
      this.session.operationVersion() !== this.version ||
      this.session.user()?.id !== this.ownerId
    ) {
      untracked(() => this.reset());
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
        const raw = await this.api.request('/policy', undefined, signal);

        this.current(signal);
        const profile = profileSchema.parse(raw);

        if (
          JSON.stringify(profile.policy) !== JSON.stringify(syntheticHybridPolicy) ||
          profile.origin !== this.document.defaultView?.location.origin
        ) {
          throw new VaultError('unavailable');
        }

        const target = params.has('tenantId')
          ? targetSchema.parse({
              tenantId: params.get('tenantId'),
              scopeId: params.get('scopeId'),
              objectId: params.get('objectId'),
            })
          : null;

        this.profile = profile;
        this.targetState.set(target);
        this.configured.set(true);

        if (target) {
          await this.loadBinding(target, signal);

          this.current(signal);

          await this.privateResource.resume(target, profile.rpId);

          this.current(signal);

          await this.loadCloud(target, signal);
        }
      });
    });
  });

  private readonly initialize = afterNextRender(() => this.rendered.set(true));
}
