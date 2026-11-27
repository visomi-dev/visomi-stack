import { Router } from '@angular/router';
import { Service, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  exampleVaultWorkspacePageSchema,
  keyDomainId,
  VaultError,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import { deviceCustodyContext, replicaId } from '@visomi-stack/web-frontend-db';

import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { VaultSession } from '../shared/vault/vault-session';

import {
  exampleLocalKey,
  examplePrivatePath,
  rosterSchema,
  scopeSchema,
  type ExampleTarget,
  type ExampleWorkspacePage,
} from './example-contracts';

/** Directory of authorized workspaces and the note to open in each one. */
@Service({ autoProvided: false })
export class ExampleVaultWorkspaces {
  private readonly router = inject(Router);
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly vault = inject(VaultSession);

  private readonly result = signal<ReturnType<typeof exampleVaultWorkspacePageSchema.parse> | null>(null);

  readonly deleting = signal<ExampleWorkspacePage['items'][number] | null>(null);

  readonly page = this.result.asReadonly();

  async deleteSelected(signal: AbortSignal) {
    const item = this.deleting();

    if (!item?.owner) {
      return;
    }

    await this.api.vault(
      '/workspaces/' + item.tenantId + '/' + item.scopeId,
      { confirmScopeId: item.scopeId },
      signal,
      'DELETE',
    );

    await this.forgetLocal(item, signal);

    this.deleting.set(null);

    await this.load(signal);
  }

  reset(): void {
    this.result.set(null);
  }

  async load(signal: AbortSignal, after?: string): Promise<void> {
    const raw = await this.api.vault(after ? `/workspaces?after=${after}` : '/workspaces', undefined, signal);
    const page = exampleVaultWorkspacePageSchema.parse(raw);

    signal.throwIfAborted();
    this.result.set({ ...page, items: [...(after ? (this.page()?.items ?? []) : []), ...page.items] });
  }

  async forgetLocal(target: ExampleWorkspacePage['items'][number], signal: AbortSignal) {
    const binding = await this.vault.localLatestBinding(exampleLocalKey(target));

    if (!binding) {
      return;
    }

    this.vault.lockContext(binding);

    const storage = await this.database.vault(binding.ownerId, signal);

    try {
      await storage.deleteKey(keyDomainId(binding.ownerId, binding.key));

      await storage.deleteKey(keyDomainId(binding.ownerId, deviceCustodyContext(binding).key));
    } finally {
      storage.close();
    }
  }

  async createWorkspace(backed: boolean, signal: AbortSignal, current: () => void) {
    const target = await (backed ? this.startSetup(signal, !!this.page()?.items.length) : this.createHarness(signal));

    current();

    if (!target) {
      await this.load(signal);

      return;
    }

    if (backed) {
      await this.router.navigate(['/db-example/vault'], { queryParams: { ...target, objectId: target.scopeId } });
    } else {
      const objectId = crypto.randomUUID();

      await this.router.navigate(['/db-example', target.tenantId, target.scopeId, objectId]);
    }
  }

  async startSetup(signal: AbortSignal, additional = false) {
    const raw = await this.api.vault('/workspaces/setup', additional ? { additional: true } : {}, signal);

    return scopeSchema.nullable().parse(raw);
  }

  async createHarness(signal: AbortSignal) {
    const parent = await this.api.vault('/tenants', {}, signal);
    const tenant = scopeSchema.parse(parent);
    const created = await this.api.vault(
      `/tenants/${tenant.tenantId}/scopes/${tenant.scopeId}/children`,
      { kind: 'resource' },
      signal,
    );

    return scopeSchema.parse(created);
  }

  async enrollment(target: ExampleTarget, binding: WrappingContext | undefined, signal: AbortSignal) {
    // This browser may unlock offline after verified setup or pairing has pinned the server's control state.
    const verified = await (binding && this.previouslyEnrolled(binding, signal));

    if (binding && verified) {
      return { phase: 'enrolled', binding } as const;
    }

    try {
      const raw = await this.api.vault(`${examplePrivatePath(target)}/devices`, undefined, signal);
      const registry = rosterSchema.parse(raw);

      if (!registry.objectBackup) {
        throw new VaultError('unavailable');
      }

      const enrolledHere = registry.devices.some(
        ({ id, ownerId, revokedAt }) => id === binding?.deviceId && ownerId === binding.ownerId && !revokedAt,
      );

      return { phase: 'enrolled', binding: enrolledHere ? binding : undefined } as const;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.error?.error === 'key_scope_uninitialized') {
        return { phase: 'empty', binding } as const;
      }

      throw error;
    }
  }

  async openWorkspace(workspace: ExampleWorkspacePage['items'][number], signal: AbortSignal, current: () => void) {
    const target = await this.target(workspace, signal);

    current();

    await this.router.navigate(['/db-example/vault'], { queryParams: target });
  }

  async target({ tenantId, scopeId, objectId }: ExampleWorkspacePage['items'][number], signal: AbortSignal) {
    if (objectId) {
      return { tenantId, scopeId, objectId };
    }

    // A note created before the stable scope-based ID may still be pending its first sync.
    const binding = await this.vault.localLatestBinding(exampleLocalKey({ tenantId, scopeId }));

    signal.throwIfAborted();

    if (!binding) {
      return { tenantId, scopeId, objectId: scopeId };
    }

    const storage = await this.database.replica(binding.ownerId, signal);

    try {
      const pending = await storage.pending(replicaId(binding.ownerId, binding.key, binding.key.scope));

      return { tenantId, scopeId, objectId: pending?.envelope.context.objectId ?? scopeId };
    } finally {
      storage.close();
    }
  }

  private async previouslyEnrolled(binding: WrappingContext, signal: AbortSignal) {
    const storage = await this.database.replica(binding.ownerId, signal);

    try {
      const verified = await storage.hasVerifiedControl(replicaId(binding.ownerId, binding.key, binding.key.scope));

      return verified;
    } finally {
      storage.close();
    }
  }
}
