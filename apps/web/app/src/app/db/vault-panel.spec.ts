import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DataContext, DataEnvelope, WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';

import { VaultPanel } from './vault-panel';
import { VaultSession } from './vault-session';

const binding: WrappingContext = {
  key: {
    product: 'synthetic-example',
    domain: 'private-resources',
    generation: 1,
    scope: { kind: 'tenant', tenantId: '11111111-1111-4111-8111-111111111111' },
  },
  ownerId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  method: 'passkey-prf',
  methodId: 'AQ',
  origin: 'https://synthetic.example.test',
};
const a: DataContext = {
  key: binding.key,
  target: binding.key.scope,
  objectId: '44444444-4444-4444-8444-444444444444',
  revision: 1,
  schemaVersion: 1,
  kind: 'record',
  previousCheckpoint: null,
};
const b = { ...a, objectId: '55555555-5555-4555-8555-555555555555' };
const envelope = (context: DataContext): DataEnvelope => ({
  format: 'visomi.data',
  version: 1,
  algorithm: 'A256GCM',
  nonce: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA',
  context,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function fixture() {
  const ready = signal(true);
  const plaintext = signal('Synthetic previously selected plaintext');
  const vault = {
    ready,
    plaintext,
    state: () => (ready() ? 'ready' : 'locked'),
    isSelected: () => true,
    lock: vi.fn(() => {
      ready.set(false);
      plaintext.set('');
    }),
    clearDisplay: () => plaintext.set(''),
    connect: vi.fn(async () => {
      ready.set(true);
    }),
    seal: vi.fn(async (context: DataContext, _value: string) => envelope(context)),
    read: vi.fn(async (_context: DataContext) => undefined),
  };

  TestBed.overrideComponent(VaultPanel, { set: { providers: [{ provide: VaultSession, useValue: vault }] } });
  const view = TestBed.createComponent(VaultPanel);

  view.componentRef.setInput('binding', binding);
  view.componentRef.setInput('context', a);
  view.componentRef.setInput('rp-id', 'synthetic.example.test');
  view.detectChanges();
  const panel = view.componentInstance;
  const saved = vi.fn();

  panel.saved.subscribe(saved);

  return { view, panel, vault, saved };
}

afterEach(() => TestBed.resetTestingModule());

it('requires explicit unlock for a newly supplied object even when its key scope is already ready', async () => {
  const f = fixture();

  expect(f.panel.ready()).toBe(false);

  await f.panel.unlock();

  expect(f.panel.ready()).toBe(true);
  f.panel.editor.set('Unfinished A');
  f.view.componentRef.setInput('context', b);
  expect(f.panel.ready()).toBe(false);
  f.view.detectChanges();
  expect(f.panel.editor()).toBe('');
  expect(f.vault.plaintext()).toBe('');

  await f.panel.save();

  await f.panel.read();

  expect(f.vault.seal).not.toHaveBeenCalled();
  expect(f.vault.read).not.toHaveBeenCalled();
});

it('never emits a late A envelope or clears the editor and busy state of a pending B save', async () => {
  const f = fixture();

  await f.panel.unlock();

  const lateA = deferred<DataEnvelope>();
  const lateB = deferred<DataEnvelope>();

  f.vault.seal.mockImplementationOnce(() => lateA.promise).mockImplementationOnce(() => lateB.promise);
  f.panel.editor.set('Synthetic A');
  const saveA = f.panel.save();

  f.view.componentRef.setInput('context', b);
  f.view.detectChanges();

  await f.panel.unlock();

  f.panel.editor.set('Synthetic B');
  const saveB = f.panel.save();

  lateA.resolve(envelope(a));

  await saveA;

  expect(f.saved).not.toHaveBeenCalled();
  expect(f.panel.busy()).toBe(true);
  expect(f.panel.editor()).toBe('Synthetic B');
  expect(f.vault.seal).toHaveBeenNthCalledWith(2, b, 'Synthetic B');
  lateB.resolve(envelope(b));

  await saveB;

  expect(f.saved).toHaveBeenCalledExactlyOnceWith(envelope(b));
  expect(f.panel.busy()).toBe(false);
});

it('does not treat a delayed obsolete unlock as permission for the new object', async () => {
  const f = fixture();
  const late = deferred<void>();

  f.vault.connect.mockImplementationOnce(() => late.promise);
  const unlocking = f.panel.unlock();

  f.view.componentRef.setInput('context', b);
  f.view.detectChanges();
  late.resolve();

  await unlocking;

  expect(f.panel.ready()).toBe(false);
  expect(f.panel.notice()).toBe('');
  expect(f.panel.busy()).toBe(false);
});

it('owns a separate display and custody session for each mounted panel', () => {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Session,
        useValue: {
          user: signal({ id: binding.ownerId }),
          full: signal(true),
          operationVersion: signal(0),
          cancellation: () => new AbortController().signal,
        },
      },
    ],
  });
  const mount = () => {
    const view = TestBed.createComponent(VaultPanel);

    view.componentRef.setInput('binding', binding);
    view.componentRef.setInput('context', a);
    view.componentRef.setInput('rp-id', 'synthetic.example.test');
    view.detectChanges();

    return view;
  };
  const first = mount();
  const second = mount();

  expect(first.componentInstance.vault).not.toBe(second.componentInstance.vault);
  expect(first.componentInstance.vault).not.toBe(TestBed.inject(VaultSession));
  expect(first.componentInstance.vault.ready()).toBe(false);
  expect(second.componentInstance.vault.ready()).toBe(false);
  first.destroy();
  second.destroy();
});
