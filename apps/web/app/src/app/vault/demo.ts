import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import type { DataContext, WrappingContext } from '@visomi-stack/shared-db';
import { createPinMethodId } from '@visomi-stack/web-frontend-db';

import { Session } from '../auth/session/session';
import { ClientDatabase, VAULT_DATABASE_NAMESPACE } from '../shared/db/database';
import { NavigationHeading } from '../shared/navigation-heading';
import { VaultPanel } from '../shared/vault/vault-panel';
import { VaultSession } from '../shared/vault/vault-session';
import { Heading, Text } from '../ui';

const scope = { kind: 'tenant', tenantId: '786cc156-1520-40d6-b884-353508731b31' } as const;
const context: DataContext = {
  key: { product: 'visomi-stack-demo', domain: 'vault-sample', scope, generation: 1 },
  target: scope,
  objectId: '9a4bbdf9-cb57-437b-a800-123847530b16',
  schemaVersion: 1,
  revision: 1,
  kind: 'record',
  previousCheckpoint: null,
};

@Component({
  selector: 'app-vault-demo',
  imports: [Heading, Text, NavigationHeading, VaultPanel],
  providers: [ClientDatabase, VaultSession, { provide: VAULT_DATABASE_NAMESPACE, useValue: 'reference-demo' }],
  templateUrl: './demo.html',
})
export class VaultDemo {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(Session);
  private readonly vault = inject(VaultSession);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly binding = signal<WrappingContext | undefined>(undefined);
  protected readonly initializing = signal(false);
  protected readonly unavailable = signal(false);
  protected readonly hostname = signal('');

  protected readonly context = context;
  protected readonly sample = $localize`:@@vaultDemoSample:Sample note: Garden workshop at 10:00.`;

  private readonly prepare = afterNextRender(async () => {
    const view = this.document.defaultView;
    const owner = this.session.user()?.id;
    const version = this.session.operationVersion();

    if (!view || !owner || !this.session.full()) {
      this.unavailable.set(true);

      return;
    }

    const current = () => !this.destroyRef.destroyed && this.session.operationVersion() === version;

    try {
      const existing = await this.vault.localBinding(context.key);

      if (!current()) {
        return;
      }

      this.hostname.set(view.location.hostname);
      this.initializing.set(!existing);
      this.binding.set(
        existing ?? {
          key: context.key,
          ownerId: owner,
          deviceId: view.crypto.randomUUID(),
          method: 'pin-argon2id',
          methodId: createPinMethodId(view.crypto),
          origin: view.location.origin,
        },
      );
    } catch {
      if (current()) {
        this.unavailable.set(true);
      }
    }
  });
}
