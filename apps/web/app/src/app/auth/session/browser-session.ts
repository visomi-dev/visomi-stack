import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Service, TransferState, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom } from 'rxjs';

import { isSession } from './models';
import type { SessionSnapshot, SessionStatus, SessionView, Providers } from './models';
import { Session, anonymousSession, initialSessionState } from './session';

@Service({ autoProvided: false })
export class BrowserSession extends Session {
  private readonly http = inject(HttpClient);
  private readonly transfer = inject(TransferState);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly value = signal<SessionSnapshot>(anonymousSession);
  private readonly state = signal<SessionStatus>('loading');
  private readonly capabilities = signal<Providers | null>(null);

  override readonly snapshot = this.value.asReadonly();
  override readonly status = this.state.asReadonly();
  override readonly providers = this.capabilities.asReadonly();

  private readonly cancellation = new Subject<void>();
  override readonly cancelled = this.cancellation.asObservable();

  private csrfToken: string | null = null;
  private revision = 0;
  private transition = 0;
  private pending: Promise<void> | null = null;
  private providerRequest: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;
  private available = true;
  private destroyed = false;

  constructor() {
    super();
    const initial = this.transfer.get(initialSessionState, null);

    if (initial) {
      this.available = initial.available;

      if (initial.session) {
        this.value.set(initial.session);
      }

      this.state.set(initial.available ? 'ready' : 'unavailable');
      this.transfer.remove(initialSessionState);
    }

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.cancelOperations();
      this.cancellation.complete();
      this.channel?.close();
    });
    afterNextRender(() => {
      const view = this.document.defaultView;

      if (!view || !this.available) {
        return;
      }

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

  override async load(force = false): Promise<void> {
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

  override async loadProviders(): Promise<void> {
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

  override async token(): Promise<string> {
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

  override accept(result: SessionView, broadcast = true): void {
    if (this.destroyed) {
      return;
    }

    const previous = this.value();

    if (!broadcast && previous.user?.id !== result.user?.id) {
      this.cancelOperations();
    } else if (
      broadcast ||
      previous.access !== result.access ||
      previous.user?.id !== result.user?.id ||
      (this.csrfToken !== null && this.csrfToken !== result.csrfToken)
    ) {
      this.transition++;
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

  override clear(): void {
    this.cancelOperations();
    this.revision++;
    this.csrfToken = null;
    this.value.set(anonymousSession);
    this.state.set('ready');
    this.channel?.postMessage('session-changed');
  }

  override invalidateToken(): void {
    this.csrfToken = null;
  }

  override async invalidate(): Promise<void> {
    this.cancelOperations();
    this.revision++;
    this.csrfToken = null;
    this.state.set('loading');

    if (this.pending) {
      await this.pending;
    }

    await this.load(true);
  }

  override operationVersion(): number {
    return this.transition;
  }

  override cancelOperations(): void {
    this.transition++;
    this.revision++;
    this.cancellation.next();
  }
}
