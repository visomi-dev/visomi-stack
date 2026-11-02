import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import {
  destination,
  safeReturnTo,
  anonymousGuard,
  fullGuard,
  unverifiedGuard,
  enrollmentGuard,
  entryGuard,
} from './navigation';
import { Session } from './session';
import type { SessionSnapshot, Access } from './models';

function snapshot(access: Access): SessionSnapshot {
  return {
    authenticated: access !== 'anonymous',
    user:
      access === 'anonymous' ? null : { id: 'synthetic', email: 'demo@example.test', emailVerified: access === 'full' },
    access,
    method: access === 'anonymous' ? null : 'passkey',
    nextStep: access === 'unverified' ? 'verify_email' : null,
  };
}
it.each([
  ['anonymous', '/auth/sign-in'],
  ['unverified', '/auth/verify-email'],
  ['full', '/home'],
  ['recovery', '/auth/recovery/enroll'],
  ['enrollment', '/auth/recovery/enroll'],
] as const)('routes %s to its allowed destination', (access, target) => {
  expect(destination(snapshot(access))).toBe(target);
});
it.each([
  'https://evil.example/home',
  '//evil.example/home',
  '/auth/sign-in',
  '/app/en/auth/sign-in',
  '/home?token=synthetic',
  '/security/../home',
  '/app/es/home',
  '/home#synthetic',
  '/home\\evil',
])('rejects unsafe return targets %s', (value) => {
  expect(safeReturnTo(value, '/app/en/')).toBe(value === '/home#synthetic' ? '/home' : null);
});
it('preserves only the allowed device review handle', () => {
  const target = '/app/es/security/devices/review?requestId=11111111-1111-4111-8111-111111111111';

  expect(safeReturnTo(target, '/app/es/')).toBe(
    '/security/devices/review?requestId=11111111-1111-4111-8111-111111111111',
  );
  expect(
    safeReturnTo('/security/devices/review?requestId=11111111-1111-4111-8111-111111111111&code=123456', '/app/es/'),
  ).toBeNull();
});
it('guards share loaded state and distinguish identity from full access', async () => {
  const current = signal(snapshot('unverified'));
  const load = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Session,
        useValue: { load, snapshot: current, status: () => 'ready', full: () => current().access === 'full' },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/security/sessions' } as RouterStateSnapshot;
  const run = (guard: typeof fullGuard) => TestBed.runInInjectionContext(() => guard(route, state));
  const result1 = await run(fullGuard);

  expect(router.serializeUrl(result1 as ReturnType<Router['parseUrl']>)).toBe('/auth/verify-email');
  const result2 = await run(unverifiedGuard);

  expect(result2).toBe(true);
  current.set(snapshot('recovery'));
  const result3 = await run(enrollmentGuard);

  expect(result3).toBe(true);
  current.set(snapshot('full'));
  const result4 = await run(fullGuard);

  expect(result4).toBe(true);
  const result5 = await run(anonymousGuard);

  expect(router.serializeUrl(result5 as ReturnType<Router['parseUrl']>)).toBe('/home');
  current.set(snapshot('anonymous'));
  const result6 = await run(anonymousGuard);

  expect(result6).toBe(true);
  const result7 = await run(entryGuard);

  expect(router.serializeUrl(result7 as ReturnType<Router['parseUrl']>)).toBe('/auth/sign-in');
});

it('redirects an unavailable former full session to sign-in instead of looping through home', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Session,
        useValue: {
          load: async () => undefined,
          snapshot: () => snapshot('full'),
          status: () => 'unavailable',
          full: () => false,
        },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const result = await TestBed.runInInjectionContext(() =>
    fullGuard({} as ActivatedRouteSnapshot, { url: '/home' } as RouterStateSnapshot),
  );

  expect(router.serializeUrl(result as ReturnType<Router['parseUrl']>)).toBe('/auth/sign-in?returnTo=%2Fhome');
});
