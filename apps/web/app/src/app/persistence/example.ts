import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { z } from 'zod';
import {
  createOperationId,
  productPolicySchema,
  syntheticHybridPolicy,
  VaultError,
} from '@visomi-stack/shared-persistence';

import { Session } from '../auth/session/session';
import { NavigationHeading } from '../shared/navigation-heading';
import { Button, Field, Heading, Text, Textarea } from '../ui';

import { PersistenceHttp } from './http';
import { ExamplePrivateResource, type ExampleTarget } from './example-private-resource';
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

@Component({
  selector: 'app-persistence-example',
  imports: [Button, Field, Heading, Text, Textarea, NavigationHeading],
  providers: [PersistenceHttp, ExamplePrivateResource],
  templateUrl: './example.html',
})
export class PersistenceExample {
  private readonly api = inject(PersistenceHttp);
  readonly privateResource = inject(ExamplePrivateResource);
  private readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly busy = signal(false);
  private readonly configured = signal(false);
  readonly notice = signal('');
  readonly target = signal<ExampleTarget | null>(null);
  readonly cloudDraft = signal('');
  readonly privateDraft = signal('');

  private readonly ownerId = this.session.user()?.id;
  private readonly version = this.session.operationVersion();
  readonly available = computed(
    () =>
      this.configured() &&
      this.session.full() &&
      this.session.user()?.id === this.ownerId &&
      this.session.operationVersion() === this.version,
  );

  readonly vault = this.privateResource.vault;
  readonly status = computed(() => vaultMessage(this.vault.state()));

  private readonly cloud = signal<z.infer<typeof cloudSchema>['items'][number] | null>(null);

  private profile: z.infer<typeof profileSchema> | undefined;

  async createWorkspace(): Promise<void> {
    await this.run(async () => {
      const parent = await this.api.request('/tenants', {});
      const tenant = scopeSchema.parse(parent);
      const created = await this.api.request(`/tenants/${tenant.tenantId}/scopes/${tenant.scopeId}/children`, {
        kind: 'resource',
      });
      const target = scopeSchema.parse(created);
      const objectId = this.document.defaultView!.crypto.randomUUID();

      await this.router.navigate(['/persistence', target.tenantId, target.scopeId, objectId]);
    });
  }

  async saveCloud(): Promise<void> {
    await this.run(async () => {
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
      );

      await this.loadCloud(target);

      this.notice.set($localize`:@@persistenceCloudSaved:Operational content was saved to the server-readable domain.`);
    });
  }

  async unlock(initialize = false): Promise<void> {
    await this.run(async () => {
      if (!this.profile) {
        throw new VaultError('unavailable');
      }

      await this.privateResource.unlock(this.requiredTarget(), this.profile.rpId, initialize);
    });
  }

  async savePrivate(): Promise<void> {
    await this.run(async () => {
      await this.privateResource.save(this.requiredTarget(), this.privateDraft());

      this.privateDraft.set('');
      this.notice.set(
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

  private async loadCloud(target: ExampleTarget) {
    const raw = await this.api.request(`${this.records(target)}?limit=1`);
    const value = cloudSchema.parse(raw).items[0] ?? null;

    this.cloud.set(value);
    this.cloudDraft.set(value?.body ?? '');
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.notice.set('');

    try {
      await work();
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.error : (error as { code?: unknown })?.code;

      this.notice.set(vaultMessage(typeof code === 'string' ? code : 'unavailable'));
    } finally {
      this.busy.set(false);
    }
  }

  private readonly clearSessionState = effect(() => {
    this.session.operationVersion();

    if (!this.vault.ready()) {
      this.privateDraft.set('');
    }

    if (!this.session.full()) {
      this.cloudDraft.set('');
      this.cloud.set(null);
      this.privateDraft.set('');
    }
  });

  private readonly initialize = afterNextRender(
    () =>
      void this.run(async () => {
        const raw = await this.api.request('/policy');
        const profile = profileSchema.parse(raw);

        if (
          JSON.stringify(profile.policy) !== JSON.stringify(syntheticHybridPolicy) ||
          profile.origin !== this.document.defaultView?.location.origin
        ) {
          throw new VaultError('unavailable');
        }

        this.profile = profile;
        this.configured.set(true);
        const params = this.route.snapshot.paramMap;

        if (params.has('tenantId')) {
          const target = targetSchema.parse({
            tenantId: params.get('tenantId'),
            scopeId: params.get('scopeId'),
            objectId: params.get('objectId'),
          });

          this.target.set(target);

          await this.loadCloud(target);
        }
      }),
  );
}
