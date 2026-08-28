import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { SIGN_IN_URL } from '../constants/routes';

import { Auth } from './auth';

export async function authenticatedGuard() {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.ensureSessionLoaded();

  return auth.isAuthenticated() ? true : router.createUrlTree([SIGN_IN_URL]);
}
