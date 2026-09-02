import type { Route } from '@angular/router';

import { anonymousGuard } from './shared/auth/anonymous-guard';
import { authenticatedGuard } from './shared/auth/authenticated-guard';
import { activatedGuard } from './shared/activation/activated-guard';
import {
  ACTIVATION_PATH,
  APP_PATH,
  DASHBOARD_PATH,
  GALLERY_PATH,
  IDENTITY_PATH,
  SECURITY_PATH,
} from './shared/constants/routes';

export const appRoutes: Route[] = [
  {
    path: APP_PATH,
    pathMatch: 'full',
    redirectTo: DASHBOARD_PATH,
  },
  {
    path: IDENTITY_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () => import('./auth/identity/identity').then((module) => module.Identity),
  },
  {
    path: DASHBOARD_PATH,
    canActivate: [activatedGuard],
    loadComponent: () => import('./dashboard/dashboard').then((module) => module.Dashboard),
  },
  {
    path: SECURITY_PATH,
    canActivate: [authenticatedGuard],
    loadComponent: () => import('./security/security').then((module) => module.Security),
  },
  {
    path: ACTIVATION_PATH,
    canActivate: [authenticatedGuard],
    loadComponent: () => import('./activation/activation').then((module) => module.Activation),
  },
  {
    path: GALLERY_PATH,
    canActivate: [authenticatedGuard],
    data: { hideAppShell: true },
    loadComponent: () => import('./gallery/gallery').then((module) => module.Gallery),
  },
  {
    path: '**',
    redirectTo: APP_PATH,
  },
];
