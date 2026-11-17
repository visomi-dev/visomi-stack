import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';
import { Navigation } from '../shared/navigation';

import { AppVaults } from './app-vaults';
import { VaultSession } from './vault-session';
import { ClientDatabase } from './database';
import { DatabaseHttp } from './http';

const binding: WrappingContext = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  key: {
    product: 'synthetic-example',
    domain: 'private-resources',
    generation: 2,
    scope: {
      kind: 'resource',
      tenantId: '33333333-3333-4333-8333-333333333333',
      groupId: null,
      resourceId: '44444444-4444-4444-8444-444444444444',
    },
  },
  method: 'pin-argon2id',
  methodId: 'A'.repeat(43),
  origin: 'https://synthetic.example.test',
};

function fixture(opened = false, method: WrappingContext['method'] = 'pin-argon2id') {
  const open = signal(opened);
  const local = { ...binding, method };
  const navigation = new AbortController();
  const version = signal(0);
  const vault = {
    knownBindings: signal([local]),
    canResume: () => open(),
    discover: vi.fn(async () => undefined),
    release: vi.fn(),
    lock: vi.fn(() => open.set(false)),
    lockContext: vi.fn(() => open.set(false)),
    connect: vi.fn(
      async (_binding: WrappingContext, _rpId: string, _initialize: boolean, _pin?: Uint8Array): Promise<void> =>
        undefined,
    ),
    device: vi.fn(async () => {
      open.set(true);
    }),
  };
  const storage = {
    pin: vi.fn(async () => ({ cursor: 1, checkpoint: 'synthetic-checkpoint', generation: 2, epoch: 3 })),
    close: vi.fn(),
  };
  const database = { replica: vi.fn(async () => storage) };
  const api = { request: vi.fn(async () => ({ origin: binding.origin, rpId: 'synthetic.example.test' })) };

  TestBed.configureTestingModule({
    providers: [
      AppVaults,
      {
        provide: Session,
        useValue: { user: signal({ id: binding.ownerId }), full: signal(true), operationVersion: version },
      },
      { provide: Router, useValue: { url: '/home' } },
      {
        provide: Navigation,
        useValue: { context: signal({ cancellation: navigation.signal }), active: signal(false) },
      },
      { provide: DOCUMENT, useValue: { defaultView: { location: { hostname: 'synthetic.example.test' } } } },
      { provide: VaultSession, useValue: vault },
      { provide: ClientDatabase, useValue: database },
      { provide: DatabaseHttp, useValue: api },
    ],
  });
  const access = TestBed.inject(AppVaults);

  TestBed.tick();

  return { access, open, vault, storage, api, navigation, version };
}

afterEach(() => TestBed.resetTestingModule());

it('offers closed local custody at app entry and unlocks PIN offline without calling any API', async () => {
  const f = fixture();

  expect(f.access.show()).toBe(true);
  f.access.pin.set('012345');

  await f.access.unlock();

  expect(f.vault.discover).toHaveBeenCalledOnce();
  expect(f.vault.connect).toHaveBeenCalledWith(
    binding,
    'synthetic.example.test',
    false,
    expect.objectContaining({ byteLength: 6 }),
  );

  expect(f.storage.close).toHaveBeenCalledOnce();
  expect(f.api.request).not.toHaveBeenCalled();
  expect(f.access.pin()).toBe('');
  expect(f.vault.connect.mock.calls[0][3]!.every((byte) => byte === 0)).toBe(true);
  expect(f.access.show()).toBe(false);
});

it('keeps an opened vault available at app entry without prompting again, and prompts after explicit lock', async () => {
  const f = fixture(true);

  expect(f.access.show()).toBe(false);
  expect(f.vault.connect).not.toHaveBeenCalled();
  f.access.lock();
  expect(f.access.show()).toBe(true);
  expect(f.vault.lock).toHaveBeenCalled();
});

it('rejects a retained generation rollback before requesting a PIN secret or touching custody', async () => {
  const f = fixture();

  f.storage.pin.mockResolvedValueOnce({ cursor: 1, checkpoint: 'synthetic-checkpoint', generation: 3, epoch: 3 });
  f.access.pin.set('012345');

  await f.access.unlock();

  expect(f.vault.connect).not.toHaveBeenCalled();
  expect(f.vault.device).not.toHaveBeenCalled();
  expect(f.storage.close).toHaveBeenCalledOnce();
  expect(f.access.notice()).toContain('Integrity could not be verified');
});

it('cancels synchronously on navigation and never restores identity from a late unlock result', async () => {
  const f = fixture();
  let finish!: () => void;

  f.vault.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );

  f.access.pin.set('012345');
  const pending = f.access.unlock();

  await vi.waitFor(() => expect(f.vault.connect).toHaveBeenCalledOnce());

  f.navigation.abort();
  expect(f.access.pin()).toBe('');
  expect(f.access.busy()).toBe(false);
  finish();

  await pending;

  expect(f.vault.device).not.toHaveBeenCalled();
  expect(f.access.notice()).toBe('');
  expect(f.vault.connect.mock.calls[0][3]!.every((byte) => byte === 0)).toBe(true);
});

it('keeps a PRF binding as PRF and uses its configured RP ID', async () => {
  const f = fixture(false, 'passkey-prf');

  await f.access.unlock();

  expect(f.api.request).toHaveBeenCalledWith('/policy', undefined, expect.any(AbortSignal));
  expect(f.vault.connect).toHaveBeenCalledWith(
    { ...binding, method: 'passkey-prf' },
    'synthetic.example.test',
    false,
    undefined,
  );

  expect(f.access.show()).toBe(false);
});
