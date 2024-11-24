import { Routes } from '@angular/router';
import concat from 'lodash/concat';

import { routes as auth } from './auth/auth.routes';
import { DASHBOARD_PATH } from './config/routes';
import { authenticatedGuard } from './shared/auth/authenticated.guard';

const base: Routes = [
  {
    path: '',
    redirectTo: DASHBOARD_PATH,
    pathMatch: 'full',
  },
  {
    path: DASHBOARD_PATH,
    loadComponent: () => import('./dashboard/dashboard.component'),
    canActivate: [authenticatedGuard],
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found.component'),
  },
];

export const routes: Routes = concat(auth, base);
