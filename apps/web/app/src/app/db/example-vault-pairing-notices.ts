import { DOCUMENT } from '@angular/common';
import { Service, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { PRIMARY_OUTLET, Router } from '@angular/router';
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
  private readonly router = inject(Router);
  private readonly view = inject(DOCUMENT).defaultView;

  private readonly rendered = signal(false);
  private readonly notices = signal<Request[]>([]);

  private readonly reviewRequest = computed(() => {
    const url = this.router.lastSuccessfulNavigation()?.finalUrl;

    if (
      url?.root.children[PRIMARY_OUTLET]?.segments[0]?.path === 'security' &&
      url.queryParamMap.get('sample') === 'vault-backup'
    ) {
      return url.queryParamMap.get('requestId');
    }

    return null;
  });
  private readonly reviewing = computed(() => !!this.reviewRequest());

  private wakeNotices?: () => void;

  readonly pending = computed(() => {
    const review = this.reviewRequest();

    return this.notices().filter(({ requestId }) => requestId !== review);
  });

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
    this.session.operationVersion();

    if (!this.rendered() || !this.examples.enabled() || !this.view) {
      this.notices.set([]);

      return;
    }

    const controller = new AbortController();
    const { wake, stop } = watchVaultPairing(
      this.view,
      () => this.load(controller.signal),
      () => !this.reviewing() && !!this.realtime?.connected(),
    );

    this.wakeNotices = wake;

    cleanup(() => {
      this.wakeNotices = undefined;
      stop();
      controller.abort();
    });
  });

  private readonly pairingHints = effect(() => {
    this.realtime?.connected();

    // The active review handles exchange hints. Poll for other requests, including a fresh attempt.
    if (!this.reviewing()) {
      this.realtime?.vaultPairingChanges();
    }

    untracked(() => this.wakeNotices?.());
  });
}
