import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';
import { syntheticHybridPolicy, VaultError, type VaultState } from '@visomi-stack/shared-db';

import { appRoutes } from '../app.routes';
import { Session } from '../auth/session/session';
import { Navigation } from '../shared/navigation';

import { DatabaseExample } from './example';
import { ExampleWorkspace } from './example-workspace';
import { ExamplePrivateResource, type ExampleTarget } from './example-private-resource';
import { DatabaseHttp } from './http';
import { UnlockCapabilities } from './unlock-capabilities';

@Component({ selector: 'app-test-persistence-layout', imports: [RouterOutlet], template: '<router-outlet />' })
class TestLayout {}

const a: ExampleTarget = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  scopeId: '22222222-2222-4222-8222-222222222222',
  objectId: '33333333-3333-4333-8333-333333333333',
};
const b: ExampleTarget = {
  tenantId: '44444444-4444-4444-8444-444444444444',
  scopeId: '55555555-5555-4555-8555-555555555555',
  objectId: '66666666-6666-4666-8666-666666666666',
};
const url = (target: ExampleTarget) => `/persistence/${target.tenantId}/${target.scopeId}/${target.objectId}`;
const records = (target: ExampleTarget) =>
  `/tenants/${target.tenantId}/scopes/${target.scopeId}/domains/operations/records`;

function fixture(
  intercept?: (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown> | undefined,
  guard: () => boolean | Promise<boolean> = () => true,
  support = 'unavailable',
) {
  const prf = signal(support);
  const capabilities = { prf, unavailable: vi.fn(() => prf.set('unavailable')) };
  const state = signal<VaultState>('locked');
  const plaintext = signal('');
  const lock = vi.fn(() => {
    state.set('locked');
    plaintext.set('');
  });
  const privateResource = {
    vault: {
      state,
      release: lock,
      localLatestBinding: vi.fn(async () => undefined),
      ready: computed(() => state() === 'ready'),
      plaintext,
      lock,
    },
    pending: signal(false),
    synchronized: signal(false),
    conflict: signal(false),
    close: vi.fn(),
    resume: vi.fn(async () => undefined),
    unlock: vi.fn(async (_target: ExampleTarget, _rpId: string, _initialize: boolean, _pin?: Uint8Array) => {
      state.set('ready');
      plaintext.set('Synthetic private A');
    }),
    save: vi.fn(async () => undefined),
    synchronize: vi.fn(async () => undefined),
    keepPending: vi.fn(async () => undefined),
    useSynchronized: vi.fn(async () => undefined),
  };
  const requests: { path: string; body: unknown; signal?: AbortSignal }[] = [];
  const api = {
    request: vi.fn(async (path: string, body?: unknown, signal?: AbortSignal) => {
      requests.push({ path, body, signal });
      const delayed = intercept?.(path, body, signal);

      if (delayed) {
        return delayed;
      }

      if (path === '/policy') {
        return { policy: syntheticHybridPolicy, origin: document.location.origin, rpId: document.location.hostname };
      }

      if (body !== undefined) {
        return {};
      }

      const target = path.startsWith(records(a)) ? a : b;

      return {
        items: [
          {
            id: target.objectId,
            title: 'Synthetic operations',
            body: target === a ? 'Cloud A' : 'Cloud B',
            revision: 1,
          },
        ],
      };
    }),
  };
  const secured = appRoutes.find((route) => route.canActivateChild)!;
  const { loadComponent: _load, ...parent } = secured;

  TestBed.configureTestingModule({
    providers: [
      { provide: UnlockCapabilities, useValue: capabilities },
      provideLocationMocks(),
      provideRouter([
        {
          ...parent,
          canActivateChild: [...(parent.canActivateChild ?? []), guard],
          component: TestLayout,
          children: secured.children!.filter((route) => route.path?.startsWith('persistence')),
        },
      ]),
      {
        provide: Session,
        useValue: {
          user: signal({ id: '77777777-7777-4777-8777-777777777777' }),
          full: signal(true),
          operationVersion: signal(0),
          load: async () => undefined,
        },
      },
    ],
  });

  TestBed.overrideComponent(DatabaseExample, {
    set: {
      providers: [
        ExampleWorkspace,
        { provide: DatabaseHttp, useValue: api },
        { provide: ExamplePrivateResource, useValue: privateResource },
      ],
    },
  });

  return { api, privateResource, requests, lock, capabilities };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

it('rebinds the real reused route before saving B and never writes the previous resource', async () => {
  const f = fixture();
  const harness = await RouterTestingHarness.create();

  await harness.navigateByUrl(url(a));

  const component = harness.routeDebugElement!.query(By.directive(DatabaseExample))
    .componentInstance as DatabaseExample;
  const page = component.workspace;

  await harness.fixture.whenStable();

  expect(page.cloudDraft()).toBe('Cloud A');

  await page.unlock();

  page.privateDraft.set('Synthetic unfinished A');

  await harness.navigateByUrl(url(b));

  await harness.fixture.whenStable();

  const reused = harness.routeDebugElement!.query(By.directive(DatabaseExample)).componentInstance as DatabaseExample;

  expect(reused).toBe(component);
  expect(TestBed.inject(Router).url).toBe(url(b));
  page.cloudDraft.set('Edit intended for B');

  await page.saveCloud();

  expect(f.requests.filter(({ body }) => body !== undefined).map(({ path }) => path)).toEqual([records(b)]);
  expect(page.target()).toEqual(b);
  expect(page.privateDraft()).toBe('');
  expect(f.privateResource.vault.ready()).toBe(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function navigate(harness: RouterTestingHarness, target: ExampleTarget) {
  await harness.navigateByUrl(url(target));

  await harness.fixture.whenStable();

  return (harness.routeDebugElement!.query(By.directive(DatabaseExample)).componentInstance as DatabaseExample)
    .workspace;
}

it('ignores an aborted late cloud read even when the transport returns it after B loads', async () => {
  const late = deferred<unknown>();
  const f = fixture((path, body) => (path.startsWith(records(a)) && body === undefined ? late.promise : undefined));
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);
  const read = f.requests.find(({ path }) => path.startsWith(records(a)))!;

  expect(page.busy()).toBe(true);

  await navigate(harness, b);

  expect(read.signal?.aborted).toBe(true);
  expect(page.cloudDraft()).toBe('Cloud B');
  late.resolve({ items: [{ id: a.objectId, title: 'Late A', body: 'Late A', revision: 9 }] });

  await harness.fixture.whenStable();

  expect(page.target()).toEqual(b);
  expect(page.cloudDraft()).toBe('Cloud B');
  expect(page.notice()).toBe('');
  expect(page.vault.ready()).toBe(false);
});

it('does not refresh A or clear the busy state of B after an already dispatched A write completes', async () => {
  const lateA = deferred<unknown>();
  const lateB = deferred<unknown>();
  const f = fixture((path, body) =>
    body !== undefined ? (path === records(a) ? lateA.promise : lateB.promise) : undefined,
  );
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);

  page.cloudDraft.set('Edit A');
  const saveA = page.saveCloud();

  await navigate(harness, b);

  page.cloudDraft.set('Edit B');
  const saveB = page.saveCloud();

  lateA.resolve({});

  await saveA;

  expect(page.busy()).toBe(true);
  expect(page.cloudDraft()).toBe('Edit B');
  expect(page.notice()).toBe('');
  expect(f.requests.filter(({ path }) => path === `${records(a)}?limit=1`)).toHaveLength(1);
  lateB.resolve({});

  await saveB;

  expect(page.busy()).toBe(false);
  expect(f.requests.filter(({ body }) => body !== undefined).map(({ path }) => path)).toEqual([records(a), records(b)]);
});

it('invalidates the selected view synchronously before a pending guard resolves or change detection runs', async () => {
  const gate = deferred<boolean>();
  let guarded = false;
  const f = fixture(undefined, () => (guarded ? gate.promise : true));
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);

  await page.unlock();

  page.privateDraft.set('Synthetic unfinished A');
  const router = TestBed.inject(Router);
  const navigation = TestBed.inject(Navigation);
  const previous = navigation.context();
  const started = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationStart)));

  guarded = true;
  const pending = router.navigateByUrl(url(b));

  await started;

  expect(previous.cancellation.aborted).toBe(true);
  expect(navigation.active()).toBe(true);
  expect(page.vault.ready()).toBe(false);
  expect(page.privateDraft()).toBe('');
  expect(f.requests[0].signal?.aborted).toBe(true);

  await page.saveCloud();

  expect(f.requests.some(({ body }) => body !== undefined)).toBe(false);
  gate.resolve(false);

  const accepted = await pending;

  await harness.fixture.whenStable();

  expect(accepted).toBe(false);
  expect(navigation.active()).toBe(false);
  expect(page.target()).toEqual(a);
  expect(page.cloudDraft()).toBe('Cloud A');
  expect(page.vault.ready()).toBe(false);
});

it.each(['tenantId', 'scopeId', 'objectId'] as const)(
  'clears the selected view and drafts for a change to $0 alone',
  async (part) => {
    const f = fixture();
    const harness = await RouterTestingHarness.create();
    const page = await navigate(harness, a);

    await page.unlock();

    page.privateDraft.set('Unfinished A');

    await navigate(harness, { ...a, [part]: b[part] });

    expect(page.target()).toEqual({ ...a, [part]: b[part] });
    expect(page.privateDraft()).toBe('');
    expect(page.vault.plaintext()).toBe('');
    expect(page.vault.ready()).toBe(false);
    expect(f.privateResource.close).toHaveBeenCalled();
    expect(f.privateResource.save).not.toHaveBeenCalled();
  },
);

it('rebinds browser history without implicit unlock when no opened local binding can resume', async () => {
  const f = fixture();
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);

  await navigate(harness, b);

  await page.unlock();

  const location = TestBed.inject(Location);
  const router = TestBed.inject(Router);

  router.setUpLocationChangeListener();
  location.back();

  await vi.waitFor(() => expect(router.url).toBe(url(a)));

  await harness.fixture.whenStable();

  expect(page.target()).toEqual(a);
  expect(page.vault.ready()).toBe(false);
  page.cloudDraft.set('Back A');

  await page.saveCloud();

  location.forward();

  await vi.waitFor(() => expect(router.url).toBe(url(b)));

  await harness.fixture.whenStable();

  expect(page.target()).toEqual(b);
  expect(page.cloudDraft()).toBe('Cloud B');
  expect(page.vault.ready()).toBe(false);
  page.cloudDraft.set('Forward B');

  await page.saveCloud();

  expect(f.requests.filter(({ body }) => body !== undefined).map(({ path }) => path)).toEqual([records(a), records(b)]);
});

it('clears PIN drafts and rejects a pending PIN unlock after Router reuses the component for another target', async () => {
  const f = fixture();
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);
  let complete!: () => void;

  f.privateResource.unlock.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );

  page.pinDraft.set('012345');
  page.pinConfirmation.set('012345');
  const pending = page.unlockWithPin(true);

  expect(page.pinDraft()).toBe('');
  expect(page.pinConfirmation()).toBe('');
  const bytes = f.privateResource.unlock.mock.calls[0][3]!;

  expect(new TextDecoder().decode(bytes)).toBe('012345');

  await navigate(harness, b);

  complete();

  await pending;

  expect(page.target()).toEqual(b);
  expect(page.vault.ready()).toBe(false);
  expect(page.pinDraft()).toBe('');
  expect(page.notice()).toBe('');
  expect(bytes.every((byte) => byte === 0)).toBe(true);
});

it.each(['available', 'unknown', 'unavailable'])(
  'offers new PIN setup only when PRF is unavailable: %s',
  async (support) => {
    fixture(undefined, undefined, support);

    const harness = await RouterTestingHarness.create();
    const page = await navigate(harness, a);

    expect(page.showPin()).toBe(support === 'unavailable');
    expect(page.showPrf()).toBe(support !== 'unavailable');
    expect(page.canInitialize()).toBe(true);
    expect(harness.routeNativeElement?.querySelector('#vault-pin') !== null).toBe(support === 'unavailable');
  },
);

it('offers PIN after an actual unsupported PRF response, but never after a user cancellation', async () => {
  const f = fixture(undefined, undefined, 'available');
  const harness = await RouterTestingHarness.create();
  const page = await navigate(harness, a);

  f.privateResource.unlock.mockRejectedValueOnce(new VaultError('cancelled'));

  await page.unlock(true);

  expect(page.showPin()).toBe(false);
  f.privateResource.unlock.mockRejectedValueOnce(new VaultError('unsupported-prf'));

  await page.unlock(true);

  expect(page.showPin()).toBe(true);
  expect(f.capabilities.unavailable).toHaveBeenCalledOnce();
});

it.each(['passkey-prf', 'pin-argon2id'] as const)(
  'honors an existing %s binding regardless of current capabilities',
  async (method) => {
    const f = fixture(undefined, undefined, method === 'passkey-prf' ? 'unavailable' : 'available');
    const local = {
      key: {
        product: 'synthetic-example',
        domain: 'private-resources',
        generation: 1,
        scope: { kind: 'resource' as const, tenantId: a.tenantId, groupId: null, resourceId: a.scopeId },
      },
      ownerId: '77777777-7777-4777-8777-777777777777',
      deviceId: a.objectId,
      method,
      methodId: method === 'pin-argon2id' ? 'A'.repeat(43) : 'AQ',
      origin: document.location.origin,
    };

    f.privateResource.vault.localLatestBinding.mockResolvedValue(local as never);

    const harness = await RouterTestingHarness.create();
    const page = await navigate(harness, a);

    expect(page.showPin()).toBe(method === 'pin-argon2id');
    expect(page.showPrf()).toBe(method === 'passkey-prf');
    expect(page.canInitialize()).toBe(false);
  },
);
