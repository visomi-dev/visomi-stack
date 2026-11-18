import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { z } from 'zod';
import { VaultError, type WrappingContext } from '@visomi-stack/shared-db';
import { replicaId } from '@visomi-stack/web-frontend-db';

import { Session } from '../../auth/session/session';
import { Navigation } from '../navigation';
import { ClientDatabase } from '../db/database';
import { DatabaseHttp } from '../db/http';

import { VaultSession } from './vault-session';
import { vaultMessage } from './vault-messages';

/** Local unlock of existing vaults in an authenticated frontend; no product vault is created or converted here. */
@Service({ autoProvided: false })
export class Vaults {
  private readonly session = inject(Session);
  private readonly navigation = inject(Navigation);
  private readonly document = inject(DOCUMENT);
  private readonly database = inject(ClientDatabase);
  private readonly api = inject(DatabaseHttp);
  private readonly destroyRef = inject(DestroyRef);

  private readonly rendered = signal(false);

  private readonly cleanup = this.destroyRef.onDestroy(() => this.cancel());

  private controller = new AbortController();

  readonly vault = inject(VaultSession);

  readonly pin = signal('');
  readonly busy = signal(false);
  readonly notice = signal('');

  readonly closed = computed(() => this.vault.knownBindings().filter((binding) => !this.vault.canResume(binding)));
  readonly binding = computed<WrappingContext | undefined>(() => this.closed()[0]);
  readonly show = computed(() => {
    this.navigation.context();

    return !this.navigation.active() && Boolean(this.binding());
  });

  async unlock(): Promise<void> {
    const binding = this.binding();

    if (!binding || this.busy()) {
      return;
    }

    const signal = this.controller.signal;
    const version = this.session.operationVersion();
    const navigation = this.navigation.context().cancellation;
    const valid = () =>
      !signal.aborted &&
      !navigation.aborted &&
      !this.navigation.active() &&
      navigation === this.navigation.context().cancellation &&
      this.session.full() &&
      this.session.operationVersion() === version &&
      this.session.user()?.id === binding.ownerId;
    const current = () => {
      if (!valid()) {
        throw new VaultError('stale-operation');
      }
    };
    const pin = binding.method === 'pin-argon2id' ? new TextEncoder().encode(this.pin()) : undefined;

    this.pin.set('');
    this.busy.set(true);
    this.notice.set('');

    try {
      current();
      let rpId = this.document.defaultView!.location.hostname;

      if (binding.method === 'passkey-prf') {
        const raw = await this.api.request('/policy', undefined, signal);

        current();
        const profile = z.object({ origin: z.url(), rpId: z.string().min(1).max(253) }).parse(raw);

        current();

        if (profile.origin !== binding.origin) {
          throw new VaultError('origin-mismatch');
        }

        rpId = profile.rpId;
      }

      const storage = await this.database.replica(binding.ownerId, signal);

      try {
        const pinned = await storage.pin(replicaId(binding.ownerId, binding.key, binding.key.scope));

        current();

        if (pinned.generation > binding.key.generation) {
          throw new VaultError('corrupt');
        }
      } finally {
        storage.close();
      }

      await this.vault.connect(binding, rpId, false, pin);

      current();

      await this.vault.device(binding, rpId, false, pin);

      current();
    } catch (error) {
      if (valid()) {
        this.vault.lockContext(binding);
        this.notice.set(vaultMessage(error instanceof VaultError ? error.code : 'unavailable'));
      }
    } finally {
      pin?.fill(0);

      if (valid()) {
        this.busy.set(false);
      }
    }
  }

  lock(): void {
    this.cancel();
    this.vault.lock();
  }

  private cancel(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.pin.set('');
    this.busy.set(false);
    this.notice.set('');
    this.vault.release();
  }

  private readonly discovery = effect(() => {
    const rendered = this.rendered();
    const version = this.session.operationVersion();
    const full = this.session.full();

    untracked(() => {
      this.cancel();

      if (rendered && full) {
        void this.vault.discover().catch(() => {
          if (this.session.operationVersion() === version && this.session.full()) {
            this.notice.set(vaultMessage('unavailable'));
          }
        });
      }
    });
  });

  private readonly navigationChanged = effect((cleanup) => {
    const signal = this.navigation.context().cancellation;
    const cancel = () => this.cancel();

    signal.addEventListener('abort', cancel, { once: true });
    cleanup(() => signal.removeEventListener('abort', cancel));
  });

  private readonly initialize = afterNextRender(() => this.rendered.set(true));
}
