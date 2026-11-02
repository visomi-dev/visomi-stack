import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { Session } from './session';
import type { SessionSnapshot } from './models';

export function destination(session: SessionSnapshot): string {
  if (session.access === 'unverified') {
    return '/auth/verify-email';
  }

  if (session.access === 'recovery' || session.access === 'enrollment') {
    return '/auth/recovery/enroll';
  }

  return session.access === 'full' && session.user?.emailVerified ? '/home' : '/auth/sign-in';
}

export function safeReturnTo(value: string | null, base: string): string | null {
  if (
    !value ||
    value.includes('\\') ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    return null;
  }

  let path = value;

  if (path.startsWith(base)) {
    path = '/' + path.slice(base.length);
  }

  if (!path.startsWith('/') || path.startsWith('//')) {
    return null;
  }

  const pathname = path.split(/[?#]/, 1)[0];

  if (
    !/^\/(?:home|account|security(?:\/(?:passkeys|password|google|totp|recovery-codes|sessions|devices\/review))?)\/?$/.test(
      pathname,
    )
  ) {
    return null;
  }

  const url = new URL(path, 'https://internal.invalid');

  if (
    url.search &&
    !(
      pathname === '/security/devices/review' &&
      [...url.searchParams.keys()].every((key) => key === 'requestId') &&
      /^[a-f0-9-]{36}$/.test(url.searchParams.get('requestId') ?? '')
    )
  ) {
    return null;
  }

  return pathname + url.search;
}

export const anonymousGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  return session.status() !== 'ready' || session.snapshot().access === 'anonymous'
    ? true
    : router.parseUrl(destination(session.snapshot()));
};
export const fullGuard: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  if (session.full()) {
    return true;
  }

  const target = session.status() === 'ready' ? destination(session.snapshot()) : '/auth/sign-in';

  return router.createUrlTree([target], { queryParams: target === '/auth/sign-in' ? { returnTo: state.url } : {} });
};
export const unverifiedGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  return session.status() === 'ready' && session.snapshot().access === 'unverified'
    ? true
    : router.parseUrl(session.status() === 'ready' ? destination(session.snapshot()) : '/auth/sign-in');
};
export const enrollmentGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  return session.status() === 'ready' && ['recovery', 'enrollment'].includes(session.snapshot().access)
    ? true
    : router.parseUrl(session.status() === 'ready' ? destination(session.snapshot()) : '/auth/sign-in');
};
export const entryGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  return router.parseUrl(session.status() === 'ready' ? destination(session.snapshot()) : '/auth/sign-in');
};
