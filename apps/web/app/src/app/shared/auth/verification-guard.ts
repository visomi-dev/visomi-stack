import { inject } from '@angular/core';
import { Router, type ActivatedRouteSnapshot } from '@angular/router';

import { APP_URL, SIGN_IN_URL } from '../constants/routes';

import { Auth } from './auth';

export async function verificationGuard(route: ActivatedRouteSnapshot) {
  const auth = inject(Auth);

  const router = inject(Router);

  await auth.ensureSessionLoaded();

  if (auth.isAuthenticated()) {
    return router.createUrlTree([APP_URL]);
  }

  const challenge = auth.pendingChallenge();

  if (!challenge) {
    return router.createUrlTree([SIGN_IN_URL]);
  }

  return challenge.purpose === route.data['verificationPurpose'] ? true : router.createUrlTree([SIGN_IN_URL]);
}
