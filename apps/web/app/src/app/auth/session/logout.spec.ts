import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER } from 'rxjs';

import { AuthenticatedLayout } from '../../layouts/authenticated-layout';
import { EmailVerify } from '../email/verify';
import { Enroll } from '../recovery/enroll';
import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';

import type { SessionSnapshot } from './models';
import { anonymousSession, Session } from './session';

@Component({ template: '' })
class SignInTarget {}

const flows = [
  { path: 'home', component: AuthenticatedLayout, access: 'full' },
  { path: 'auth/verify-email', component: EmailVerify, access: 'unverified' },
  { path: 'auth/recovery/enroll', component: Enroll, access: 'enrollment' },
] as const;

async function openFlow({ path, access }: (typeof flows)[number]) {
  const snapshot = signal<SessionSnapshot>({
    authenticated: true,
    user: { id: 'synthetic', email: 'demo@example.test', emailVerified: access !== 'unverified' },
    access,
    method: 'password',
    nextStep: access === 'unverified' ? 'verify_email' : access === 'enrollment' ? 'enroll_method' : null,
  });
  const session = {
    snapshot,
    status: () => 'ready' as const,
    user: () => snapshot().user,
    full: () => snapshot().access === 'full',
    cancelled: NEVER,
    cancelOperations: vi.fn(),
    operationVersion: () => 0,
    token: vi.fn().mockResolvedValue('synthetic-csrf'),
    clear: vi.fn(() => snapshot.set(anonymousSession)),
    load: vi.fn<Session['load']>().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([...flows, { path: 'auth/sign-in', component: SignInTarget }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      Journey,
      { provide: Session, useValue: session },
    ],
  });

  const harness = await RouterTestingHarness.create('/' + path);
  const journey = TestBed.inject(Journey);

  journey.start('email', { flowId: 'synthetic', expiresAt: '2099-01-01T00:00:00Z' });
  const clearNotification = vi.spyOn(TestBed.inject(AuthNavigation), 'clearNotification');

  await harness.fixture.whenStable();

  const signOut = Array.from(harness.routeNativeElement!.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === 'Sign out',
  )!;
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);

  return { harness, signOut, http, session, journey, clearNotification, router };
}

it.each(flows)('signs out from $path and only clears its own flow state', async (flow) => {
  const { signOut, http, session, journey, clearNotification, router } = await openFlow(flow);

  signOut.click();

  await Promise.resolve();

  const request = http.expectOne({ method: 'POST', url: '/api/auth/logout' });

  expect(request.request.body).toEqual({});
  expect(session.cancelOperations).toHaveBeenCalledBefore(session.token);
  expect(session.clear).not.toHaveBeenCalled();
  request.flush(null, { status: 204, statusText: 'No Content' });

  await vi.waitFor(() => expect(router.url).toBe('/auth/sign-in'));

  expect(session.clear).toHaveBeenCalledOnce();
  expect(journey.challenge() === null).toBe(flow.component === EmailVerify);
  expect(clearNotification).toHaveBeenCalledTimes(flow.component === AuthenticatedLayout ? 1 : 0);
  expect(session.load).not.toHaveBeenCalled();
});

it('continues from the authenticated layout if a failed request already ended the session', async () => {
  const { signOut, http, session, clearNotification, router } = await openFlow(flows[0]);

  session.load.mockImplementationOnce(async () => session.snapshot.set(anonymousSession));
  signOut.click();

  await Promise.resolve();

  http.expectOne('/api/auth/logout').flush({ error: 'csrf_invalid' }, { status: 403, statusText: 'Forbidden' });

  await vi.waitFor(() => expect(router.url).toBe('/auth/sign-in'));

  expect(session.load).toHaveBeenCalledExactlyOnceWith(true);
  expect(session.clear).not.toHaveBeenCalled();
  expect(clearNotification).not.toHaveBeenCalled();
});

it.each(flows)('keeps $path open when logout fails and the session remains active', async (flow) => {
  const { harness, signOut, http, session, journey, clearNotification, router } = await openFlow(flow);

  signOut.click();

  await Promise.resolve();

  http.expectOne('/api/auth/logout').flush({ error: 'csrf_invalid' }, { status: 403, statusText: 'Forbidden' });

  await vi.waitFor(() => expect(harness.routeNativeElement?.textContent).toContain('Your session changed.'));

  expect(router.url).toBe('/' + flow.path);
  expect(session.load).toHaveBeenCalledTimes(flow.component === AuthenticatedLayout ? 1 : 0);
  expect(session.clear).not.toHaveBeenCalled();
  expect(journey.challenge()).not.toBeNull();
  expect(clearNotification).not.toHaveBeenCalled();
});
