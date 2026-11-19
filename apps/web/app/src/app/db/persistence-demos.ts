import { DestroyRef, Service, afterNextRender, computed, inject, signal } from '@angular/core';

import { Session } from '../auth/session/session';
import { DatabaseHttp } from '../shared/db/http';

@Service({ autoProvided: false })
export class PersistenceDemos {
  private readonly api = inject(DatabaseHttp);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);

  private readonly confirmed = signal<number | undefined>(undefined);

  readonly checked = signal(false);

  readonly enabled = computed(() => this.session.full() && this.confirmed() === this.session.operationVersion());

  private readonly check = afterNextRender(async () => {
    const version = this.session.operationVersion();
    const signal = this.session.cancellation();

    try {
      const raw = await this.api.request('/cloud-example/policy', undefined, signal);
      const document = raw as {
        policy?: { product?: unknown };
      } | null;

      if (!signal.aborted && !this.destroyRef.destroyed && document?.policy?.product === 'synthetic-cloud-example') {
        this.confirmed.set(version);
      }
    } catch {
      // In the default profile the development route is absent.
    } finally {
      if (!this.destroyRef.destroyed) {
        this.checked.set(true);
      }
    }
  });
}
