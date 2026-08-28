import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { DASHBOARD_URL } from '../constants/routes';

import { Auth } from './auth';

export async function anonymousGuard() {
  const auth = inject(Auth);

  const router = inject(Router);

  await auth.ensureSessionLoaded();

  return auth.isAuthenticated() ? router.createUrlTree([DASHBOARD_URL]) : true;
}
