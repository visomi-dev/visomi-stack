import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { Session } from './session';
import type { SessionSnapshot } from './models';

const uuidPathSegment = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const cloudReturnPath = new RegExp(`^/db-example/cloud(?:/(?:join|${uuidPathSegment}/${uuidPathSegment}))?$`);
const vaultReturnUuid =
  /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

export function destination(session: SessionSnapshot): string {
  switch (session.access) {
    case 'unverified':
      return '/auth/verify-email';
    case 'recovery':
    case 'enrollment':
      return '/auth/recovery/enroll';
    case 'full':
      return session.user?.emailVerified ? '/home' : '/auth/sign-in';
    default:
      return '/auth/sign-in';
  }
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

  const vaultPath = '/db-example/vault';

  if (pathname === vaultPath || pathname === '/vault/unlock') {
    if (path === pathname) {
      return pathname === vaultPath ? vaultPath : null;
    }

    const { hash, searchParams } = new URL(path, 'https://internal.invalid');
    const target = {
      tenantId: searchParams.get('tenantId') ?? '',
      scopeId: searchParams.get('scopeId') ?? '',
      objectId: searchParams.get('objectId') ?? '',
    };

    return !hash && searchParams.size === 3 && Object.values(target).every((id) => vaultReturnUuid.test(id))
      ? `${vaultPath}?${new URLSearchParams(target)}`
      : null;
  }

  if (cloudReturnPath.test(pathname)) {
    return path === pathname ? pathname : null;
  }

  if (
    !/^\/(?:home|account|security(?:\/(?:passkeys|password|google|totp|recovery-codes|sessions|devices\/review))?)\/?$/.test(
      pathname,
    )
  ) {
    return null;
  }

  const url = new URL(path, 'https://internal.invalid');

  if (pathname === '/security' && url.searchParams.get('sample') === 'vault-backup') {
    const keys = ['tenantId', 'scopeId', 'objectId', 'requestId'];

    return !url.hash &&
      url.searchParams.size === keys.length + 1 &&
      keys.every((key) => vaultReturnUuid.test(url.searchParams.get(key) ?? ''))
      ? pathname + url.search
      : null;
  }

  if (
    url.search &&
    !(
      pathname === '/security/devices/review' &&
      url.searchParams.size === 1 &&
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
  const location = inject(Location);
  const session = inject(Session);
  const router = inject(Router);

  await session.load();

  if (session.full()) {
    return true;
  }

  const target = session.status() === 'ready' ? destination(session.snapshot()) : '/auth/sign-in';

  const returnTo = target === '/auth/sign-in' ? safeReturnTo(state.url, location.prepareExternalUrl('/')) : null;

  return router.createUrlTree([target], { queryParams: returnTo ? { returnTo } : {} });
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
