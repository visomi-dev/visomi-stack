import type { Routes } from '@angular/router';

import { anonymousGuard, enrollmentGuard, entryGuard, fullGuard, unverifiedGuard } from './auth/session/navigation';

export const appRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [entryGuard],
    loadComponent: () => import('./auth/layouts/not-found').then((m) => m.NotFound),
  },
  { path: 'foundations', loadComponent: () => import('./foundations/foundations').then((m) => m.Foundations) },
  {
    path: 'auth',
    loadComponent: () => import('./auth/layouts/auth-layout').then((m) => m.AuthLayout),
    children: [
      {
        path: 'sign-in',
        pathMatch: 'full',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/passkeys/sign-in').then((m) => m.SignIn),
      },
      {
        path: 'sign-up',
        pathMatch: 'full',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/passkeys/sign-up').then((m) => m.SignUp),
      },
      {
        path: 'sign-in/password',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/password/credentials').then((m) => m.PasswordCredentials),
      },
      {
        path: 'sign-up/password',
        canActivate: [anonymousGuard],
        data: { signup: true },
        loadComponent: () => import('./auth/password/credentials').then((m) => m.PasswordCredentials),
      },
      {
        path: 'sign-in/verify',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/password/verify').then((m) => m.PasswordVerify),
      },
      {
        path: 'verify-email',
        canActivate: [unverifiedGuard],
        loadComponent: () => import('./auth/email/verify').then((m) => m.EmailVerify),
      },
      {
        path: 'forgot-password',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/password/reset-request').then((m) => m.ResetRequest),
      },
      {
        path: 'reset-password',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/password/reset').then((m) => m.PasswordReset),
      },
      { path: 'google/verify-email', loadComponent: () => import('./auth/google/verify').then((m) => m.GoogleVerify) },
      {
        path: 'reauthenticate',
        canActivate: [fullGuard],
        loadComponent: () => import('./auth/session/reauthenticate').then((m) => m.Reauthenticate),
      },
      {
        path: 'recovery',
        pathMatch: 'full',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/recovery/request').then((m) => m.RecoveryRequest),
      },
      {
        path: 'recovery/verify',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/recovery/verify').then((m) => m.RecoveryVerify),
      },
      {
        path: 'recovery/enroll',
        canActivate: [enrollmentGuard],
        loadComponent: () => import('./auth/recovery/enroll').then((m) => m.Enroll),
      },
      {
        path: 'device-approval',
        canActivate: [anonymousGuard],
        loadComponent: () => import('./auth/devices/request').then((m) => m.DeviceApproval),
      },
    ],
  },
  {
    path: '',
    canActivate: [fullGuard],
    canActivateChild: [fullGuard],
    loadComponent: () => import('./auth/layouts/authenticated-layout').then((m) => m.AuthenticatedLayout),
    children: [
      { path: 'home', loadComponent: () => import('./auth/layouts/home').then((m) => m.Home) },
      { path: 'account', loadComponent: () => import('./auth/email/account').then((m) => m.Account) },
      {
        path: 'security',
        pathMatch: 'full',
        loadComponent: () => import('./auth/session/security').then((m) => m.Security),
      },
      {
        path: 'security/passkeys',
        loadComponent: () => import('./auth/passkeys/manage').then((m) => m.ManagePasskeys),
      },
      {
        path: 'security/password',
        loadComponent: () => import('./auth/password/manage').then((m) => m.ManagePassword),
      },
      { path: 'security/google', loadComponent: () => import('./auth/google/manage').then((m) => m.ManageGoogle) },
      { path: 'security/totp', loadComponent: () => import('./auth/totp/manage').then((m) => m.ManageTotp) },
      {
        path: 'security/recovery-codes',
        loadComponent: () => import('./auth/totp/backup-codes').then((m) => m.BackupCodes),
      },
      { path: 'security/sessions', loadComponent: () => import('./auth/session/sessions').then((m) => m.Sessions) },
      {
        path: 'security/devices/review',
        loadComponent: () => import('./auth/devices/review').then((m) => m.DeviceReview),
      },
    ],
  },
  { path: '**', loadComponent: () => import('./auth/layouts/not-found').then((m) => m.NotFound) },
];
