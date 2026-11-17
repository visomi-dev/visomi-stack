import { IndexedDbVaultStorage } from '@visomi-stack/web-frontend-db/storage';
import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserVault, DeviceCustody, PrfUnlock, WebCryptoCipher } from '@visomi-stack/web-frontend-db';
import { VaultError, type WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';

import { VaultSession } from './vault-session';

const binding: WrappingContext = {
  key: {
    product: 'synthetic-example',
    domain: 'private-resources',
    scope: { kind: 'tenant', tenantId: '11111111-1111-4111-8111-111111111111' },
    generation: 1,
  },
  ownerId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  method: 'passkey-prf',
  methodId: 'AQ',
  origin: 'https://synthetic.example.test',
};
const context = {
  key: binding.key,
  target: binding.key.scope,
  objectId: '44444444-4444-4444-8444-444444444444',
  schemaVersion: 1,
  revision: 1,
  kind: 'record' as const,
  previousCheckpoint: null,
};

function fixture(browser = true) {
  const openCipher = vi
    .spyOn(WebCryptoCipher.prototype, 'open')
    .mockImplementation(async () => new TextEncoder().encode('Synthetic private view'));

  vi.spyOn(WebCryptoCipher.prototype, 'unwrap').mockResolvedValue(new Uint8Array(32));
  vi.spyOn(WebCryptoCipher.prototype, 'importDataKey').mockResolvedValue({} as CryptoKey);
  vi.spyOn(PrfUnlock.prototype, 'secret').mockImplementation(async () => new Uint8Array(32));
  const close = vi.spyOn(BrowserVault.prototype, 'close');
  const currentKey = vi.fn(async () => ({ context: binding }));
  const latestBindings = vi.fn(async () => [binding]);
  const openStorage = vi.spyOn(IndexedDbVaultStorage, 'open').mockResolvedValue({
    getKey: vi.fn(async () => ({ context: binding })),
    getCurrentKey: currentKey,
    latestBindings,
    getUnit: vi.fn(async () => ({})),
    close: vi.fn(),
  } as unknown as IndexedDbVaultStorage);
  const user = signal({ id: binding.ownerId });
  const full = signal(true);
  const version = signal(0);
  const cancellation = new AbortController();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: Session,
        useValue: { user, full, operationVersion: version, cancellation: () => cancellation.signal },
      },
      {
        provide: DOCUMENT,
        useValue: {
          defaultView: browser
            ? {
                location: { origin: binding.origin },
                indexedDB: {},
                isSecureContext: true,
                navigator: { credentials: {} },
                crypto: { subtle: {}, getRandomValues: vi.fn() },
              }
            : null,
        },
      },
    ],
  });
  const vault = TestBed.inject(VaultSession);

  TestBed.tick();

  return { vault, user, full, version, cancellation, openCipher, close, openStorage, currentKey, latestBindings };
}

describe('vault account lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());
  it('selects active local bindings through the current-generation guard and preserves rollback rejection', async () => {
    const f = fixture();
    const current = await f.vault.localBinding(binding.key);

    expect(current).toEqual(binding);
    expect(f.currentKey).toHaveBeenCalledWith(binding.ownerId, binding.key);
    f.currentKey.mockRejectedValueOnce(new VaultError('corrupt'));

    await expect(f.vault.localBinding(binding.key)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('keeps cloud login locked, unlocks only explicitly and clears on synchronous cancellation', async () => {
    const f = fixture();

    expect(f.vault.state()).toBe('locked');
    expect(f.openStorage).not.toHaveBeenCalled();

    await f.vault.connect(binding, 'synthetic.example.test');

    await f.vault.read(context);

    expect(f.vault.plaintext()).toBe('Synthetic private view');
    f.cancellation.abort();
    expect(f.vault.plaintext()).toBe('');
    expect(f.vault.state()).toBe('locked');
    expect(f.close).toHaveBeenCalled();
  });

  it('hides old plaintext immediately on an account/version change, before effects run', async () => {
    const f = fixture();

    await f.vault.connect(binding, 'synthetic.example.test');

    await f.vault.read(context);

    f.version.set(1);
    f.user.set({ id: '55555555-5555-4555-8555-555555555555' });
    expect(f.vault.plaintext()).toBe('');
    expect(f.vault.ready()).toBe(false);

    await expect(f.vault.read(context)).rejects.toMatchObject({ code: 'locked' });

    TestBed.tick();
    expect(f.close).toHaveBeenCalled();
  });

  it('rejects and wipes a delayed plaintext result after logout', async () => {
    const f = fixture();

    await f.vault.connect(binding, 'synthetic.example.test');

    const clear = new TextEncoder().encode('Synthetic delayed plaintext');
    let complete: (value: Uint8Array<ArrayBuffer>) => void = () => undefined;

    f.openCipher.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          complete = resolve;
        }),
    );
    const reading = f.vault.read(context);

    await vi.waitFor(() => expect(f.openCipher).toHaveBeenCalled());

    f.cancellation.abort();
    complete(clear);

    await expect(reading).rejects.toMatchObject({ code: 'stale-operation' });

    expect(clear.every((value) => value === 0)).toBe(true);
    expect(f.vault.plaintext()).toBe('');
  });

  it('does not open client storage or decrypt during SSR, origin mismatch or a different account', async () => {
    const f = fixture(false);

    await expect(f.vault.connect(binding, 'synthetic.example.test')).rejects.toMatchObject({ code: 'unavailable' });

    expect(f.openStorage).not.toHaveBeenCalled();
    f.full.set(false);

    await expect(f.vault.connect(binding, 'synthetic.example.test')).rejects.toMatchObject({ code: 'locked' });
  });
});

it('does not let a late previous connect lock a newer explicit unlock of the same cached scope', async () => {
  const f = fixture();
  let resolve!: () => void;
  const unlock = vi.spyOn(BrowserVault.prototype, 'unlock');

  unlock.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const old = f.vault.connect(binding, 'synthetic.example.test');
  const rejected = expect(old).rejects.toMatchObject({ code: 'stale-operation' });

  await vi.waitFor(() => expect(unlock).toHaveBeenCalledTimes(1));

  f.vault.lock();

  await f.vault.connect(binding, 'synthetic.example.test');

  expect(f.vault.ready()).toBe(true);
  resolve();

  await rejected;

  expect(f.vault.ready()).toBe(true);
});

it('retains fully opened custody across view release without a second PRF ceremony, but clears the display', async () => {
  const f = fixture();
  const secret = vi.mocked(PrfUnlock.prototype.secret);

  await f.vault.connect(binding, 'synthetic.example.test');

  await f.vault.read(context);

  f.vault.release();

  expect(f.vault.ready()).toBe(false);
  expect(f.vault.plaintext()).toBe('');
  expect(f.vault.isOpen(binding)).toBe(true);

  await f.vault.connect(binding, 'synthetic.example.test');

  expect(f.vault.ready()).toBe(true);
  expect(secret).toHaveBeenCalledTimes(1);
  expect(f.vault.resume({ ...binding, deviceId: '55555555-5555-4555-8555-555555555555' })).toBe(false);
  f.vault.lock();
  expect(f.vault.isOpen(binding)).toBe(false);

  await f.vault.connect(binding, 'synthetic.example.test');

  expect(secret).toHaveBeenCalledTimes(2);
});

it('synchronously cancels a pending ceremony on release instead of treating its late result as an opened vault', async () => {
  const f = fixture();
  let finish!: (bytes: Uint8Array) => void;
  const secret = vi.mocked(PrfUnlock.prototype.secret).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.vault.connect(binding, 'synthetic.example.test');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'stale-operation' });

  await vi.waitFor(() => expect(secret).toHaveBeenCalled());

  f.vault.release();
  const late = new Uint8Array(32).fill(7);

  finish(late);

  await rejected;

  expect(f.vault.isOpen(binding)).toBe(false);
  expect(f.vault.ready()).toBe(false);
  expect(late.every((byte) => byte === 0)).toBe(true);
});

it('does not forget a newly opened vault when startup metadata discovery finishes late', async () => {
  const f = fixture();
  let finish!: (bindings: WrappingContext[]) => void;

  f.latestBindings.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const discovery = f.vault.discover();

  await vi.waitFor(() => expect(f.latestBindings).toHaveBeenCalled());

  await f.vault.connect(binding, 'synthetic.example.test');

  finish([]);

  await discovery;

  expect(f.vault.knownBindings()).toEqual([binding]);
  f.cancellation.abort();
  expect(f.vault.knownBindings()).toEqual([]);
});

it('requires both resource key and independent device custody for an application view to resume', async () => {
  const f = fixture();

  vi.spyOn(DeviceCustody.prototype, 'unlock').mockResolvedValue(undefined);
  vi.spyOn(DeviceCustody.prototype, 'ready', 'get').mockReturnValue(true);

  await f.vault.connect(binding, 'synthetic.example.test');

  expect(f.vault.canResume(binding)).toBe(false);

  const custody = await f.vault.device(binding, 'synthetic.example.test');

  expect(f.vault.canResume(binding)).toBe(true);
  f.vault.release();
  expect(f.vault.canResume(binding)).toBe(true);

  const reused = await f.vault.device(binding, 'synthetic.example.test');

  expect(reused).toBe(custody);
  expect(DeviceCustody.prototype.unlock).toHaveBeenCalledOnce();
  const lock = vi.spyOn(custody, 'lock');

  f.vault.lockContext(binding);
  expect(lock).toHaveBeenCalledOnce();
  expect(f.vault.canResume(binding)).toBe(false);
});

it('keeps an unrelated opened scope available when another local unlock fails', async () => {
  const f = fixture();
  const other = {
    ...binding,
    key: { ...binding.key, scope: { kind: 'tenant' as const, tenantId: '55555555-5555-4555-8555-555555555555' } },
  };

  await f.vault.connect(binding, 'synthetic.example.test');

  await f.vault.connect(other, 'synthetic.example.test');

  f.vault.lockContext(other);

  expect(f.vault.isOpen(binding)).toBe(true);
  expect(f.vault.isOpen(other)).toBe(false);
  expect(f.vault.plaintext()).toBe('');
  f.vault.lock();
  expect(f.vault.isOpen(binding)).toBe(false);
});
