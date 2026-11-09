import { makeStateKey, type Signal } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AuthRenderContext, Providers, SessionSnapshot, SessionStatus, SessionView } from './models';

export const initialSessionState = makeStateKey<AuthRenderContext>('auth-initial-session');
export const anonymousSession: SessionSnapshot = {
  authenticated: false,
  user: null,
  access: 'anonymous',
  method: null,
  nextStep: null,
};

export function isFullSession(status: SessionStatus, snapshot: SessionSnapshot): boolean {
  return status === 'ready' && snapshot.access === 'full' && snapshot.user?.emailVerified === true;
}

export abstract class Session {
  abstract readonly snapshot: Signal<SessionSnapshot>;
  abstract readonly status: Signal<SessionStatus>;
  abstract readonly full: Signal<boolean>;
  abstract readonly user: Signal<SessionSnapshot['user']>;
  abstract readonly providers: Signal<Providers | null>;
  abstract readonly cancelled: Observable<void>;

  abstract load(force?: boolean): Promise<void>;

  abstract loadProviders(): Promise<void>;

  abstract token(): Promise<string>;

  abstract accept(result: SessionView, broadcast?: boolean): void;

  abstract clear(): void;

  abstract invalidateToken(): void;

  abstract invalidate(): Promise<void>;

  abstract operationVersion(): number;

  abstract cancelOperations(): void;
}
