import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserVault, IndexedDbVaultStorage, PrfUnlock, WebCryptoCipher } from '@visomi-stack/web-shared-vault';
import { VaultError, type WrappingContext } from '@visomi-stack/shared-persistence';

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
  const openStorage = vi.spyOn(IndexedDbVaultStorage, 'open').mockResolvedValue({
    getKey: vi.fn(async () => ({ context: binding })),
    getCurrentKey: currentKey,
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

  return { vault, user, full, version, cancellation, openCipher, close, openStorage, currentKey };
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
