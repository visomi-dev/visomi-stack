import { Service, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { exampleVaultWorkspacePageSchema, VaultError, type WrappingContext } from '@visomi-stack/shared-db';
import { replicaId } from '@visomi-stack/web-frontend-db';

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
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly vault = inject(VaultSession);

  private readonly result = signal<ReturnType<typeof exampleVaultWorkspacePageSchema.parse> | null>(null);

  readonly page = this.result.asReadonly();

  reset(): void {
    this.result.set(null);
  }

  async load(signal: AbortSignal, after?: string): Promise<void> {
    const raw = await this.api.vault(after ? `/workspaces?after=${after}` : '/workspaces', undefined, signal);
    const page = exampleVaultWorkspacePageSchema.parse(raw);

    signal.throwIfAborted();
    this.result.set({ ...page, items: [...(after ? (this.page()?.items ?? []) : []), ...page.items] });
  }

  async startSetup(signal: AbortSignal) {
    const raw = await this.api.vault('/workspaces/setup', {}, signal);

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
