import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

import { ACCESS_TOKEN_KEY } from '../../config/storage';
import { DASHBOARD_PATH } from '../../config/routes';

import { AuthService } from './auth.service';

export const anonymousGuard: CanActivateFn = async (): Promise<
  boolean | UrlTree
> => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const platform = inject(PLATFORM_ID);

  if (isPlatformBrowser(platform)) {
    let user = authService.user();

    if (user == null && localStorage.getItem(ACCESS_TOKEN_KEY) != null) {
      user = await authService.getUser();
    }

    if (user != null) {
      return router.parseUrl(`/${DASHBOARD_PATH}`);
    }

    return true;
  }

  return true;
};
