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
  LEGACY_IDENTITY_PATH,
  SECURITY_PATH,
  SIGN_UP_PATH,
  EMAIL_VERIFICATION_PATH,
  PASSWORD_RESET_PATH,
  RECOVERY_CODES_PATH,
  PASSWORD_MANAGEMENT_PATH,
  REAUTHENTICATION_PATH,
  GOOGLE_LINK_PATH,
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
    path: LEGACY_IDENTITY_PATH,
    redirectTo: IDENTITY_PATH,
    pathMatch: 'full',
  },
  {
    path: SIGN_UP_PATH,
    canActivate: [anonymousGuard],
    data: {
      hideAppShell: true,
      title: 'Create an account',
    },
    loadComponent: () => import('./auth/sign-up/sign-up').then((module) => module.SignUp),
  },
  {
    path: EMAIL_VERIFICATION_PATH,
    canActivate: [anonymousGuard],
    data: { hideAppShell: true },
    loadComponent: () =>
      import('./auth/email-verification/email-verification').then((module) => module.EmailVerification),
  },
  {
    path: PASSWORD_RESET_PATH,
    canActivate: [anonymousGuard],
    data: {
      hideAppShell: true,
      title: 'Reset your password',
    },
    loadComponent: () => import('./auth/password-reset/password-reset').then((module) => module.PasswordReset),
  },
  {
    path: RECOVERY_CODES_PATH,
    canActivate: [authenticatedGuard],
    data: {
      hideAppShell: true,
      title: 'Recovery codes',
      description: 'Regenerate one-time recovery codes after confirming your identity.',
    },
    loadComponent: () => import('./auth/recovery-codes/recovery-codes').then((module) => module.RecoveryCodes),
  },
  {
    path: PASSWORD_MANAGEMENT_PATH,
    canActivate: [authenticatedGuard],
    data: {
      hideAppShell: true,
      title: 'Password and authenticator',
      description: 'Manage your password and authenticator app.',
    },
    loadComponent: () =>
      import('./auth/password-management/password-management').then((module) => module.PasswordManagement),
  },
  {
    path: REAUTHENTICATION_PATH,
    canActivate: [authenticatedGuard],
    data: {
      hideAppShell: true,
      title: 'Confirm your identity',
      description: 'Use your existing passkey to confirm your identity before a sensitive action.',
    },
    loadComponent: () => import('./auth/reauthentication/reauthentication').then((module) => module.Reauthentication),
  },
  {
    path: GOOGLE_LINK_PATH,
    canActivate: [authenticatedGuard],
    data: {
      hideAppShell: true,
      title: 'Link Google',
      description: 'Link a Google identity after confirming that it belongs to you.',
    },
    loadComponent: () => import('./auth/google-link/google-link').then((module) => module.GoogleLink),
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
