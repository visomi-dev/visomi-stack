import { Routes } from '@angular/router';

import { SIGN_IN_PATH } from '../config/routes';
import { anonymousGuard } from '../shared/auth/anonymous.guard';

export const routes: Routes = [
  {
    path: SIGN_IN_PATH,
    canActivate: [anonymousGuard],
    loadComponent: () => import('./sign-in/sign-in.component'),
  },
];
