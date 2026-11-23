import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { safeReturnTo } from '../../auth/session/navigation';

export const vaultUnlockTargetGuard: CanActivateFn = (_route, state) => {
  const location = inject(Location);
  const router = inject(Router);
  const destination = safeReturnTo(state.url, location.prepareExternalUrl('/'));

  return destination?.startsWith('/db-example/vault?') || router.createUrlTree(['/db-example/vault']);
};
