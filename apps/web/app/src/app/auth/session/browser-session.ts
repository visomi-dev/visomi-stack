import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Service, TransferState, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom } from 'rxjs';

import { isSession } from './models';
import type { SessionSnapshot, SessionStatus, SessionView, Providers } from './models';
import { SessionRealtime } from './realtime';
import { type Session, anonymousSession, initialSessionState, isFullSession } from './session';

@Service({ autoProvided: false })
export class BrowserSession implements Session {
  private readonly http = inject(HttpClient);
  private readonly transfer = inject(TransferState);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtime = inject(SessionRealtime);

  private readonly value = signal<SessionSnapshot>(anonymousSession);
  private readonly state = signal<SessionStatus>('loading');
  private readonly capabilities = signal<Providers | null>(null);
  private readonly realtimeGeneration = signal(0);
  private readonly rendered = signal(false);

  readonly full = computed(() => isFullSession(this.state(), this.value()));
  readonly user = computed(() => this.value().user);
  private readonly realtimeSession = computed(() =>
    this.rendered() && this.full() ? this.realtimeGeneration() : null,
  );

  readonly snapshot = this.value.asReadonly();
  readonly status = this.state.asReadonly();
  readonly providers = this.capabilities.asReadonly();

  private readonly cancellation = new Subject<void>();
  readonly cancelled = this.cancellation.asObservable();

  private readonly available = this.restoreInitialSession();
  private readonly cleanup = this.destroyRef.onDestroy(() => this.dispose());

  private csrfToken: string | null = null;
  private revision = 0;
  private transition = 0;
  private pending: Promise<void> | null = null;
  private providerRequest: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;
  private destroyed = false;

  async load(force = false): Promise<void> {
    if (!this.available || this.destroyed) {
      return;
    }

    if (this.pending) {
      return this.pending;
    }

    if (!force && this.state() === 'ready') {
      return;
    }

    const revision = this.revision;
    const pending = firstValueFrom(
      this.http
        .get<SessionView>('/api/auth/session', { transferCache: false })
        .pipe(takeUntilDestroyed(this.destroyRef)),
    )
      .then((result) => {
        if (!isSession(result)) {
          throw new Error('authentication_response_invalid');
        }

        if (this.revision === revision && !this.destroyed) {
          this.accept(result, false);
        }
      })
      .catch(() => {
        if (this.revision === revision && !this.destroyed) {
          this.state.set('unavailable');
        }
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null;
        }
      });

    this.pending = pending;

    return pending;
  }

  async loadProviders(): Promise<void> {
    if (!this.available || this.destroyed || this.capabilities()) {
      return;
    }

    if (this.providerRequest) {
      return this.providerRequest;
    }

    this.providerRequest = firstValueFrom(
      this.http
        .get<Providers>('/api/auth/providers', { transferCache: false })
        .pipe(takeUntilDestroyed(this.destroyRef)),
    )
      .then((result) => {
        if (!this.destroyed) {
          this.capabilities.set(result);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.providerRequest = null;
      });

    return this.providerRequest;
  }

  async token(): Promise<string> {
    if (!this.csrfToken || this.state() !== 'ready') {
      await this.load(true);
    }

    // A read already in flight may have been invalidated by logout or another tab.
    if (!this.csrfToken && this.state() !== 'unavailable') {
      await this.load(true);
    }

    if (!this.csrfToken || this.state() !== 'ready') {
      throw new Error('authentication_unavailable');
    }

    return this.csrfToken;
  }

  accept(result: SessionView, broadcast = true): void {
    if (this.destroyed) {
      return;
    }

    const previous = this.value();
    const changedUser = previous.user?.id !== result.user?.id;
    const rotated = this.csrfToken !== null && this.csrfToken !== result.csrfToken;

    if (!broadcast && changedUser) {
      this.cancelOperations();
    } else if (broadcast || previous.access !== result.access || changedUser || rotated) {
      this.transition++;
    }

    if (broadcast || changedUser || rotated) {
      this.realtimeGeneration.update((value) => value + 1);
    }

    this.revision++;
    this.csrfToken = result.csrfToken;
    const { authenticated, user, access, method, nextStep } = result;

    this.value.set({ authenticated, user, access, method, nextStep });
    this.state.set('ready');

    if (broadcast) {
      this.channel?.postMessage('session-changed');
    }
  }

  clear(): void {
    this.cancelOperations();
    this.revision++;
    this.csrfToken = null;
    this.value.set(anonymousSession);
    this.state.set('ready');
    this.channel?.postMessage('session-changed');
  }

  invalidateToken(): void {
    this.csrfToken = null;
  }

  async invalidate(): Promise<void> {
    this.cancelOperations();
    this.revision++;
    this.csrfToken = null;
    this.state.set('loading');

    if (this.pending) {
      await this.pending;
    }

    await this.load(true);
  }

  operationVersion(): number {
    return this.transition;
  }

  cancelOperations(): void {
    this.transition++;
    this.revision++;
    this.cancellation.next();
  }

  private restoreInitialSession(): boolean {
    const initial = this.transfer.get(initialSessionState, null);

    if (!initial) {
      return true;
    }

    this.value.set(initial.session ?? anonymousSession);
    this.state.set(initial.available ? 'ready' : 'unavailable');
    this.transfer.remove(initialSessionState);

    return initial.available;
  }

  private dispose(): void {
    this.destroyed = true;
    this.cancelOperations();
    this.cancellation.complete();
    this.channel?.close();
  }

  private async refreshRealtime(): Promise<void> {
    // A read already in progress may have observed the state before the notice.
    if (this.pending) {
      await this.pending;
    }

    await this.load(true);
  }

  private readonly syncRealtime = effect((onCleanup) => {
    if (this.realtimeSession() !== null) {
      onCleanup(this.realtime.connectSession(() => void this.refreshRealtime()));
    }
  });

  private readonly initialize = afterNextRender(() => {
    const view = this.document.defaultView;

    if (!view || !this.available) {
      return;
    }

    this.rendered.set(true);

    const refresh = () => {
      if (this.document.visibilityState !== 'hidden') {
        void this.load(true);
      }
    };

    view.addEventListener('focus', refresh);

    if ('BroadcastChannel' in view) {
      try {
        this.channel = new BroadcastChannel('visomi-auth');
        this.channel.onmessage = (event: MessageEvent<unknown>) => {
          if (event.data === 'session-changed') {
            void this.invalidate();
          }
        };
      } catch {
        // Focus revalidation also works when the browser denies cross-tab channels.
        this.channel = null;
      }
    }

    this.destroyRef.onDestroy(() => view.removeEventListener('focus', refresh));
    void this.load(true);
    void this.loadProviders();
  });
}
