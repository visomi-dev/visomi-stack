import { REQUEST_CONTEXT, Service, TransferState, computed, inject, signal } from '@angular/core';
import { NEVER } from 'rxjs';

import type { AuthRenderContext, Providers, SessionSnapshot, SessionStatus, SessionView } from './models';
import { type Session, anonymousSession, initialSessionState, isFullSession } from './session';

@Service({ autoProvided: false })
export class ServerSession implements Session {
  private readonly transfer = inject(TransferState);

  private readonly initial = this.transferSession(
    (inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthRenderContext } | null)?.auth,
  );

  readonly snapshot = signal(this.initial.session ?? anonymousSession).asReadonly();
  readonly status = signal<SessionStatus>(this.initial.available ? 'ready' : 'unavailable').asReadonly();
  readonly providers = signal<Providers | null>(null).asReadonly();

  readonly full = computed(() => isFullSession(this.status(), this.snapshot()));
  readonly user = computed(() => this.snapshot().user);

  readonly cancelled = NEVER;

  // The auth runtime already resolved this request; SSR never refreshes through HTTP.
  load(_force = false): Promise<void> {
    return Promise.resolve();
  }

  loadProviders(): Promise<void> {
    return Promise.resolve();
  }

  operationVersion(): number {
    return 0;
  }

  token(): Promise<string> {
    return Promise.reject(new Error('browser_required'));
  }

  accept(_result: SessionView, _broadcast = true): void {
    throw new Error('browser_required');
  }

  clear(): void {
    throw new Error('browser_required');
  }

  invalidateToken(): void {
    throw new Error('browser_required');
  }

  invalidate(): Promise<void> {
    return Promise.reject(new Error('browser_required'));
  }

  cancelOperations(): void {
    throw new Error('browser_required');
  }

  private transferSession(context?: AuthRenderContext): AuthRenderContext {
    const source = context?.session;
    const session: SessionSnapshot | null = source
      ? {
          authenticated: source.authenticated,
          user: source.user
            ? { id: source.user.id, email: source.user.email, emailVerified: source.user.emailVerified }
            : null,
          access: source.access,
          method: source.method,
          nextStep: source.nextStep,
        }
      : null;
    const initial = { available: context?.available ?? false, session };

    this.transfer.set(initialSessionState, initial);

    return initial;
  }
}
