import { DOCUMENT } from '@angular/common';
import { Service, afterNextRender, effect, inject, signal } from '@angular/core';
import { exampleVaultPairingListSchema } from '@visomi-stack/shared-db';
import type { z } from 'zod';

import { BrowserRealtimeSession } from '../auth/session/browser-realtime-session';
import { Session } from '../auth/session/session';
import { DatabaseHttp } from '../shared/db/http';
import { VaultSession } from '../shared/vault/vault-session';

import { ExampleAvailability } from './example-availability';
import { exampleLocalKey } from './example-contracts';
import { watchVaultPairing } from './example-vault-pairing-watch';

type Request = z.infer<typeof exampleVaultPairingListSchema>[number];

@Service({ autoProvided: false })
export class ExampleVaultPairingNotices {
  private readonly api = inject(DatabaseHttp);
  private readonly session = inject(Session);
  private readonly vault = inject(VaultSession);
  private readonly examples = inject(ExampleAvailability);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });
  private readonly view = inject(DOCUMENT).defaultView;

  private readonly rendered = signal(false);
  private readonly notices = signal<Request[]>([]);

  readonly pending = this.notices.asReadonly();

  private async load(signal: AbortSignal): Promise<void> {
    try {
      const raw = await this.api.vault('/pairing-requests', undefined, signal);
      const requests = exampleVaultPairingListSchema.parse(raw);
      const bindings = await Promise.all(
        requests.map((request) => this.vault.localBinding({ ...exampleLocalKey(request), generation: 1 })),
      );

      if (!signal.aborted) {
        this.notices.set(requests.filter((_request, index) => Boolean(bindings[index])));
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
