import { createEnvironmentInjector, EnvironmentInjector, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { config } from '../../app.config.server';
import { BrowserRoutePerformance } from '../../observability/browser-route-performance';

import { BrowserSession } from './browser-session';
import type { AuthRenderContext, SessionSnapshot, SessionView } from './models';
import { Session, initialSessionState } from './session';
import { ServerSession } from './server-session';

const full: SessionSnapshot = {
  authenticated: true,
  user: { id: 'synthetic-user', email: 'demo@example.test', emailVerified: true },
  access: 'full',
  method: 'passkey',
  nextStep: null,
};

beforeEach(() =>
  TestBed.configureTestingModule({
    providers: [ServerSession, { provide: Session, useExisting: ServerSession }],
  }),
);

it('selects the server implementation from the merged application config without resolving the browser service', () => {
  TestBed.configureTestingModule({ providers: config.providers });
  TestBed.overrideProvider(BrowserRoutePerformance, { useValue: {} });
  TestBed.overrideProvider(BrowserSession, {
    useFactory: () => {
      throw new Error('browser_provider_used_during_ssr');
    },
  });
  TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { auth: { available: true, session: full } } });
  const session = TestBed.inject(Session);

  expect(session).toBe(TestBed.inject(ServerSession));
  expect(session.full()).toBe(true);
});

it('uses the request snapshot without HTTP or browser dependencies even for forced loads', async () => {
  TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { auth: { available: true, session: full } } });
  const session = TestBed.inject(Session);

  await session.load(true);

  await session.loadProviders();

  expect(session.snapshot()).toEqual(full);
  expect(session.status()).toBe('ready');
  expect(session.full()).toBe(true);
  expect(session.providers()).toBeNull();
});

it('transfers only public snapshot fields, excluding internal context and user secrets', () => {
  const extended = {
    ...full,
    csrfToken: 'synthetic-private-csrf',
    sid: 'synthetic-private-sid',
    grantId: 'synthetic-private-grant',
    user: { ...full.user!, passwordHash: 'synthetic-private-hash' },
  };

  TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { auth: { available: true, session: extended } } });
  const session = TestBed.inject(Session);
  const transfer = TestBed.inject(TransferState);

  expect(session.snapshot()).toEqual(full);
  expect(transfer.get(initialSessionState, null)).toEqual({ available: true, session: full });
  expect(transfer.toJson()).not.toContain('synthetic-private');
});

it('preserves the standalone unavailable state when the server has no auth context', async () => {
  const session = TestBed.inject(Session);

  await session.load();

  expect(session.status()).toBe('unavailable');
  expect(session.full()).toBe(false);
  expect(TestBed.inject(TransferState).get(initialSessionState, null)).toEqual({ available: false, session: null });
});

it('keeps request identities and transfer state isolated across server injectors', () => {
  const createRequest = (session: SessionSnapshot) =>
    createEnvironmentInjector(
      [
        ServerSession,
        { provide: Session, useExisting: ServerSession },
        { provide: REQUEST_CONTEXT, useValue: { auth: { available: true, session } satisfies AuthRenderContext } },
        { provide: TransferState, useFactory: () => new TransferState() },
      ],
      TestBed.inject(EnvironmentInjector),
    );
  const first = createRequest(full);
  const second = createRequest({ ...full, user: { ...full.user!, id: 'another-user', email: 'other@example.test' } });

  try {
    expect(first.get(Session).user()?.id).toBe('synthetic-user');
    expect(second.get(Session).user()?.id).toBe('another-user');
    expect(first.get(TransferState).toJson()).not.toContain('other@example.test');
    expect(second.get(TransferState).toJson()).not.toContain('demo@example.test');
  } finally {
    first.destroy();
    second.destroy();
  }
});

it('rejects browser session operations instead of issuing mutations or changing the render identity', async () => {
  TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { auth: { available: true, session: full } } });
  const session = TestBed.inject(Session);

  await expect(session.token()).rejects.toThrow('browser_required');

  await expect(session.invalidate()).rejects.toThrow('browser_required');

  expect(() => session.accept({ ...full, csrfToken: 'synthetic-csrf' } as SessionView)).toThrow('browser_required');
  expect(() => session.clear()).toThrow('browser_required');
  expect(() => session.invalidateToken()).toThrow('browser_required');
  expect(() => session.cancelOperations()).toThrow('browser_required');
  expect(session.snapshot()).toEqual(full);
});
