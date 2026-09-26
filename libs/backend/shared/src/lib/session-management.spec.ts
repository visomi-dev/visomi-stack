import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';

import { ManagedMemorySessionStore, isManagedSessionStore } from './session';
import type { ManagedSessionStore, SessionScope } from './session';

function payload(userId = 'alice', authVersion = 2, expires = Date.now() + 60000): SessionData {
  const cookie = new Cookie();

  cookie.expires = new Date(expires);

  return {
    cookie,
    ...{ passport: { user: { id: userId, authVersion } }, authority: 'full', authenticationMethod: 'password' },
  };
}

const scope: SessionScope = { userId: 'alice', authVersion: 2, currentSid: 'current', secret: 'test-management-key' };

function save(store: ManagedSessionStore, sid: string, data = payload()): Promise<void> {
  return new Promise((resolve, reject) => store.set(sid, data, (error) => (error ? reject(error) : resolve())));
}
function get(store: ManagedSessionStore, sid: string): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) => store.get(sid, (error, data) => (error ? reject(error) : resolve(data))));
}
function destroy(store: ManagedSessionStore, sid: string): Promise<void> {
  return new Promise((resolve, reject) => store.destroy(sid, (error) => (error ? reject(error) : resolve())));
}
function touch(store: ManagedSessionStore, sid: string): Promise<void> {
  return new Promise((resolve, reject) =>
    store.touch!(sid, payload(), (error?: unknown) => (error ? reject(error) : resolve())),
  );
}

describe('memory session management', () => {
  let store: ManagedSessionStore;

  beforeEach(async () => {
    store = new ManagedMemorySessionStore();
    await save(store, 'current');
  });

  it('lists only live full sessions of the current user and auth version using opaque handles', async () => {
    await save(store, 'current');
    await save(store, 'other');
    await save(store, 'foreign', payload('bob'));
    await save(store, 'bob-current', payload('bob'));
    await save(store, 'stale', payload('alice', 1));
    await save(store, 'expired', payload('alice', 2, Date.now() - 1000));
    await save(store, 'restricted', { ...payload(), ...{ authority: 'restricted' } });
    const sessions = await store.listManagedSessions(scope);

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((item) => item.current)).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ method: 'password', id: expect.stringMatching(/^[\w-]{43}$/) });
    expect(JSON.stringify(sessions)).not.toContain('passport');
    expect(await get(store, 'expired')).toBeNull();
    expect(isManagedSessionStore(store)).toBe(true);
  });

  it('scopes selected revocation and excludes the current session from all-other revocation', async () => {
    await save(store, 'current');
    await save(store, 'other');
    await save(store, 'foreign', payload('bob'));
    const other = (await store.listManagedSessions(scope)).find((item) => !item.current)!;

    await save(store, 'bob-current', payload('bob'));
    expect(await store.revokeManagedSessions({ ...scope, userId: 'bob', currentSid: 'bob-current' }, other.id)).toBe(0);
    expect(
      await store.revokeManagedSessions(
        scope,
        (await store.listManagedSessions(scope)).find((item) => item.current)!.id,
      ),
    ).toBe(0);
    expect(await store.revokeManagedSessions(scope, other.id)).toBe(1);
    await save(store, 'third');
    expect(await store.revokeManagedSessions(scope)).toBe(1);
    expect(await get(store, 'current')).toBeTruthy();
    expect(await get(store, 'foreign')).toBeTruthy();
    expect(await get(store, 'other')).toBeNull();
  });

  it('never resurrects revoked sessions through delayed saves or touches', async () => {
    await save(store, 'other');
    const inFlightSnapshot = await get(store, 'other');

    expect(inFlightSnapshot).toBeTruthy();
    await store.revokeManagedSessions(scope);
    await Promise.all([save(store, 'other', inFlightSnapshot!), touch(store, 'other')]);
    expect(await get(store, 'other')).toBeNull();
    expect(await store.listManagedSessions(scope)).toEqual([expect.objectContaining({ current: true })]);
  });

  it('tombstones unknown SIDs while allowing regeneration to a fresh SID', async () => {
    await destroy(store, 'not-yet-saved');
    await Promise.all([save(store, 'not-yet-saved'), touch(store, 'not-yet-saved')]);
    await save(store, 'fresh');
    expect(await get(store, 'not-yet-saved')).toBeNull();
    expect(await get(store, 'fresh')).toBeTruthy();
  });

  it('handles both save/destroy orderings without reviving the old SID', async () => {
    await Promise.all([save(store, 'race'), destroy(store, 'race')]);
    await save(store, 'race');
    expect(await get(store, 'race')).toBeNull();
  });

  it('cleans expired payloads and retains tombstones when clearing memory', async () => {
    await save(store, 'live');
    await save(store, 'expired', payload('alice', 2, Date.now() - 1000));
    const count = await new Promise<number | undefined>((resolve) =>
      store.length!((_error, length) => resolve(length)),
    );

    expect(count).toBe(2);
    await new Promise<void>((resolve, reject) => store.clear!((error) => (error ? reject(error) : resolve())));
    await save(store, 'live');
    expect(await get(store, 'live')).toBeNull();
  });
});
