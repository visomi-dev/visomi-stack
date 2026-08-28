import type { Route } from '@angular/router';

import { anonymousGuard } from './shared/auth/anonymous-guard';
import { authenticatedGuard } from './shared/auth/authenticated-guard';
import { verificationGuard } from './shared/auth/verification-guard';
import { activatedGuard } from './shared/activation/activated-guard';
import {
  ACTIVATION_PATH,
  APP_PATH,
  DASHBOARD_PATH,
  FORGOTTEN_PASSWORD_PATH,
  GALLERY_PATH,
  RESET_PASSWORD_PATH,
  SECURITY_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  VERIFY_DEVICE_PATH,
  VERIFY_EMAIL_PATH,
} from './shared/constants/routes';

export const appRoutes: Route[] = [
  {
    path: APP_PATH,
    pathMatch: 'full',
    redirectTo: DASHBOARD_PATH,
  },
  {
    path: SIGN_IN_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () => import('./auth/sign-in/sign-in').then((module) => module.SignIn),
  },
  {
    path: SIGN_UP_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () => import('./auth/sign-up/sign-up').then((module) => module.SignUp),
  },
  {
    path: VERIFY_EMAIL_PATH,
    canActivate: [verificationGuard],
    data: { hideAppShell: true, verificationPurpose: 'sign_up' },
    loadComponent: () => import('./auth/verify-email/verify-email').then((module) => module.VerifyEmail),
  },
  {
    path: VERIFY_DEVICE_PATH,
    canActivate: [verificationGuard],
    data: { hideAppShell: true, verificationPurpose: 'sign_in' },
    loadComponent: () => import('./auth/verify-device/verify-device').then((module) => module.VerifyDevice),
  },
  {
    path: FORGOTTEN_PASSWORD_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () =>
      import('./auth/forgotten-password/forgotten-password').then((module) => module.ForgottenPassword),
  },
  {
    path: RESET_PASSWORD_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () => import('./auth/reset-password/reset-password').then((module) => module.ResetPassword),
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
