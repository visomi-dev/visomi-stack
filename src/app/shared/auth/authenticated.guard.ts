import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

import { ACCESS_TOKEN_KEY } from '../../config/storage';
import { SIGN_IN_PATH } from '../../config/routes';

import { AuthService } from './auth.service';

export const authenticatedGuard: CanActivateFn = async (): Promise<
  boolean | UrlTree
> => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const platform = inject(PLATFORM_ID);

  if (isPlatformBrowser(platform)) {
    let user = authService.user();

    try {
      if (user == null && localStorage.getItem(ACCESS_TOKEN_KEY) != null) {
        user = await authService.getUser();
      }
    } catch (error) {
      console.error(error);

      return router.parseUrl(`/${SIGN_IN_PATH}`);
    }

    if (user == null) {
      return router.parseUrl(`/${SIGN_IN_PATH}`);
    }

    return true;
  }

  return router.parseUrl(`/${SIGN_IN_PATH}`);
};
