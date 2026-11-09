import { REQUEST_CONTEXT, Service, TransferState, inject, signal, type Signal } from '@angular/core';
import { NEVER } from 'rxjs';

import type { AuthRenderContext, Providers, SessionSnapshot, SessionStatus, SessionView } from './models';
import { Session, anonymousSession, initialSessionState } from './session';

@Service({ autoProvided: false })
export class ServerSession extends Session {
  override readonly providers = signal<Providers | null>(null).asReadonly();

  override readonly snapshot: Signal<SessionSnapshot>;
  override readonly status: Signal<SessionStatus>;
  override readonly cancelled = NEVER;

  constructor() {
    super();

    const context = inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthRenderContext } | null;
    const initial = context?.auth ?? { available: false, session: null };
    const source = initial.session;
    const snapshot: SessionSnapshot = source
      ? {
          authenticated: source.authenticated,
          user: source.user
            ? { id: source.user.id, email: source.user.email, emailVerified: source.user.emailVerified }
            : null,
          access: source.access,
          method: source.method,
          nextStep: source.nextStep,
        }
      : anonymousSession;

    this.snapshot = signal(snapshot).asReadonly();
    this.status = signal<SessionStatus>(initial.available ? 'ready' : 'unavailable').asReadonly();

    inject(TransferState).set(initialSessionState, {
      available: initial.available,
      session: source ? snapshot : null,
    });
  }

  // The auth runtime already resolved this request; SSR never refreshes through HTTP.
  override load(_force = false): Promise<void> {
    return Promise.resolve();
  }

  override loadProviders(): Promise<void> {
    return Promise.resolve();
  }

  override operationVersion(): number {
    return 0;
  }

  override token(): Promise<string> {
    return Promise.reject(new Error('browser_required'));
  }

  override accept(_result: SessionView, _broadcast = true): void {
    throw new Error('browser_required');
  }

  override clear(): void {
    throw new Error('browser_required');
  }

  override invalidateToken(): void {
    throw new Error('browser_required');
  }

  override invalidate(): Promise<void> {
    return Promise.reject(new Error('browser_required'));
  }

  override cancelOperations(): void {
    throw new Error('browser_required');
  }
}
