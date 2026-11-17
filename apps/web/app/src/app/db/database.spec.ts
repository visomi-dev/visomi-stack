import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IndexedDbReplicaStorage, IndexedDbVaultStorage } from '@visomi-stack/web-frontend-db/storage';

import { Session } from '../auth/session/session';

import { ClientDatabase } from './database';

const owner = '11111111-1111-4111-8111-111111111111';

function fixture(browser = true) {
  const user = signal({ id: owner });
  const version = signal(0);
  const factory = {};
  const close = vi.fn();
  const openVault = vi
    .spyOn(IndexedDbVaultStorage, 'open')
    .mockResolvedValue({ close } as unknown as IndexedDbVaultStorage);
  const openReplica = vi
    .spyOn(IndexedDbReplicaStorage, 'open')
    .mockResolvedValue({ close } as unknown as IndexedDbReplicaStorage);

  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT, useValue: { defaultView: browser ? { indexedDB: factory } : null } },
      { provide: Session, useValue: { user, operationVersion: version, full: signal(true) } },
    ],
  });

  return { database: TestBed.inject(ClientDatabase), factory, user, version, close, openVault, openReplica };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

it('opens databases lazily for the authenticated account and leaves connection lifetime with the consumer', async () => {
  const f = fixture();

  expect(f.openVault).not.toHaveBeenCalled();
  expect(f.openReplica).not.toHaveBeenCalled();

  const vault = await f.database.vault(owner);
  const replica = await f.database.replica(owner);

  expect(f.openVault).toHaveBeenCalledWith(f.factory, owner);
  expect(f.openReplica).toHaveBeenCalledWith(f.factory, owner);
  expect(f.close).not.toHaveBeenCalled();
  vault.close();
  replica.close();
  expect(f.close).toHaveBeenCalledTimes(2);
});

it('does not open IndexedDB on the server or for another account', async () => {
  const f = fixture(false);

  await expect(f.database.vault(owner)).rejects.toMatchObject({ code: 'unavailable' });

  await expect(f.database.replica('22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({
    code: 'unavailable',
  });

  expect(f.openVault).not.toHaveBeenCalled();
  expect(f.openReplica).not.toHaveBeenCalled();
});

it.each(['navigation', 'account', 'destroy'] as const)(
  'closes a connection that finishes opening after $0 invalidates its consumer',
  async (reason) => {
    const f = fixture();
    let resolve!: (storage: IndexedDbReplicaStorage) => void;

    f.openReplica.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const opening = f.database.replica(owner, controller.signal);
    const rejected = expect(opening).rejects.toMatchObject({ code: 'stale-operation' });

    await vi.waitFor(() => expect(f.openReplica).toHaveBeenCalledTimes(1));

    if (reason === 'navigation') {
      controller.abort();
    } else if (reason === 'account') {
      f.version.set(1);
    } else {
      TestBed.resetTestingModule();
    }

    resolve({ close: f.close } as unknown as IndexedDbReplicaStorage);

    await rejected;

    expect(f.close).toHaveBeenCalledTimes(1);
  },
);
