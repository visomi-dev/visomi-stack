import { inject } from '@angular/core';
import { Router, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';

import { Auth } from '../auth/auth';
import { ACTIVATION_URL, IDENTITY_URL } from '../constants/routes';

import { Activation } from './activation';
import type { ActivationMilestone } from './activation.models';

function hasCompletedActivation(milestones: ActivationMilestone[]) {
  return milestones.includes('activation_completed') || milestones.includes('activation_skipped');
}

export async function activatedGuard(_route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) {
  const auth = inject(Auth);
  const activation = inject(Activation);
  const router = inject(Router);

  await auth.ensureSessionLoaded();

  if (!auth.isAuthenticated()) {
    return router.createUrlTree([IDENTITY_URL]);
  }

  const activationData = await activation.loadState();

  return hasCompletedActivation(activationData.milestones) ? true : router.createUrlTree([ACTIVATION_URL]);
}
