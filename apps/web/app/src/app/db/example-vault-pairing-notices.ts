import { DOCUMENT } from '@angular/common';
import { Service, afterNextRender, effect, inject, signal } from '@angular/core';
import { exampleVaultPairingListSchema, syntheticHybridPolicy } from '@visomi-stack/shared-db';
import type { z } from 'zod';

import { BrowserRealtimeSession } from '../auth/session/browser-realtime-session';
import { Session } from '../auth/session/session';
import { DatabaseHttp } from '../shared/db/http';
import { ClientDatabase } from '../shared/db/database';

import { ExampleAvailability } from './example-availability';
import { watchVaultPairing } from './example-vault-pairing-watch';

type Request = z.infer<typeof exampleVaultPairingListSchema>[number];

@Service({ autoProvided: false })
export class ExampleVaultPairingNotices {
  private readonly api = inject(DatabaseHttp);
  private readonly session = inject(Session);
  private readonly database = inject(ClientDatabase);
  private readonly examples = inject(ExampleAvailability);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });
  private readonly view = inject(DOCUMENT).defaultView;

  private readonly rendered = signal(false);
  private readonly notices = signal<Request[]>([]);

  readonly pending = this.notices.asReadonly();

  private async load(signal: AbortSignal): Promise<void> {
    try {
      const owner = this.session.user()?.id;

      if (!owner) {
        return;
      }

      const storage = await this.database.vault(owner, signal);
      const scopes = new Set<string>();

      try {
        const bindings = await storage.latestBindings(owner);

        for (const { key } of bindings) {
          if (
            key.product === syntheticHybridPolicy.product &&
            key.domain === 'private-resources' &&
            key.scope.kind === 'resource'
          ) {
            scopes.add(key.scope.tenantId + '/' + key.scope.resourceId);
          }
        }
      } finally {
        storage.close();
      }
      signal.throwIfAborted();

      // Only browsers with a local vault binding can review requests. Unlinked browsers need no inbox poll.
      const raw = await (scopes.size ? this.api.vault('/pairing-requests', undefined, signal) : []);
      const requests = exampleVaultPairingListSchema.parse(raw);

      if (!signal.aborted) {
        this.notices.set(requests.filter((request) => scopes.has(request.tenantId + '/' + request.scopeId)));
      }
    } catch {
      if (!signal.aborted) {
        this.notices.set([]);
      }
    }
  }

  private readonly activate = afterNextRender(() => this.rendered.set(true));

  private readonly watch = effect((cleanup) => {
    this.realtime?.vaultPairingChanges();
    this.realtime?.connected();
    this.session.operationVersion();

    if (!this.rendered() || !this.examples.enabled() || !this.view) {
      this.notices.set([]);

      return;
    }

    const controller = new AbortController();
    const stop = watchVaultPairing(
      this.view,
      () => this.load(controller.signal),
      () => !!this.realtime?.connected(),
    );

    cleanup(() => {
      stop();
      controller.abort();
    });
  });
}
