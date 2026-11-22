import { Service, inject, signal } from '@angular/core';
import { exampleWorkspacePageSchema } from '@visomi-stack/shared-db';
import { replicaId } from '@visomi-stack/web-frontend-db';

import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { VaultSession } from '../shared/vault/vault-session';

import { exampleLocalKey, scopeSchema, type ExampleWorkspacePage } from './example-contracts';

/** Directory of authorized workspaces and the note to open in each one. */
@Service({ autoProvided: false })
export class ExampleVaultWorkspaces {
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly vault = inject(VaultSession);

  private readonly result = signal<ExampleWorkspacePage | null>(null);

  readonly page = this.result.asReadonly();

  reset(): void {
    this.result.set(null);
  }

  async load(signal: AbortSignal, after?: string): Promise<void> {
    const raw = await this.api.vault(after ? `/workspaces?after=${after}` : '/workspaces', undefined, signal);
    const page = exampleWorkspacePageSchema.parse(raw);

    signal.throwIfAborted();
    this.result.set({ ...page, items: [...(after ? (this.page()?.items ?? []) : []), ...page.items] });
  }

  async create(objectBackup: boolean, signal: AbortSignal) {
    const parent = await this.api.vault('/tenants', {}, signal);
    const tenant = scopeSchema.parse(parent);
    const created = await this.api.vault(
      `/tenants/${tenant.tenantId}/scopes/${tenant.scopeId}/children`,
      objectBackup ? { kind: 'resource', objectBackup: true } : { kind: 'resource' },
      signal,
    );

    return scopeSchema.parse(created);
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
}
