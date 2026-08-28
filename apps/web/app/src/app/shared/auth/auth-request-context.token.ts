import { InjectionToken } from '@angular/core';

import type { AuthUser } from './auth.models';

export type AuthRequestContext = {
  user: AuthUser | null;
};

export const AUTH_REQUEST_CONTEXT = new InjectionToken<AuthRequestContext | null>('AUTH_REQUEST_CONTEXT', {
  providedIn: 'root',
  factory: () => null,
});
