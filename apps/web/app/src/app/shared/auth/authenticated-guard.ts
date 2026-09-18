import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';

import { SIGN_IN_URL } from '../constants/routes';

import { Auth } from './auth';

export const authenticatedGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.ensureSessionLoaded();

  return auth.isAuthenticated() ? true : router.createUrlTree([SIGN_IN_URL], { queryParams: { returnTo: state.url } });
};
