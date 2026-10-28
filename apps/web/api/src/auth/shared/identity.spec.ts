import { describe, expect, it } from 'vitest';

import { current, flow, granted, session, storage, user } from '../../../tests/support/auth-state';
import { activeMethod, lastMethod, lockIdentity, principal, readPrincipal } from '../shared/identity';

describe('identity revocation decisions', () => {
  it('rejects absent users, stale versions, removed passwords and revoked methods', async () => {
    for (const rows of [[], [{ ...user, authVersion: 2 }], [{ ...user, passwordHash: null }]]) {
      const f = storage([rows]);
      const value = await readPrincipal(f.db, current);

      expect(value).toBe(false);
    }
    const revoked = storage([[user], []]);
    const result1 = await readPrincipal(revoked.db, principal(user, 'passkey', 'synthetic-key'));

    expect(result1).toBe(false);
    const downgraded = storage([[{ ...user, emailVerifiedAt: null }]]);
    const result2 = await readPrincipal(downgraded.db, current);

    expect(result2).toMatchObject({ level: 'unverified', emailVerified: false });
  });
  it('does not treat an enrollment permission as a full session or allow another browser to use it', async () => {
    const absent = storage([[]]);
    const result3 = await activeMethod(absent.db, granted);

    expect(result3).toBe(false);
    const wrongLevel = storage([[flow]]);
    const result4 = await activeMethod(wrongLevel.db, { ...granted, level: 'full' });

    expect(result4).toBe(false);
    const otherBrowser = storage([[user], [session], [flow], []]);

    await expect(lockIdentity(otherBrowser.tx, session.sid, granted)).rejects.toMatchObject({
      code: 'authentication_required',
    });

    await expect(lockIdentity(storage().tx, session.sid, { id: user.id, authenticatedAt: 0 })).rejects.toMatchObject({
      code: 'authentication_required',
    });

    const legacyGrant = storage([[flow]]);
    const result5 = await activeMethod(legacyGrant.db, { ...granted, grantId: undefined });

    expect(result5).toBe(true);
  });
  it('counts enabled primary providers, not backup factors, when removing the last method', async () => {
    const providers = storage([[], [{ id: 'other-google' }]]);

    await expect(
      lastMethod(providers.tx, { ...user, passwordHash: null }, 'google', 'target-google'),
    ).resolves.toBeUndefined();

    const disabled = storage([[], [{ id: 'other-google' }]]);

    await expect(
      lastMethod(disabled.tx, { ...user, passwordHash: null }, 'google', 'target-google', false),
    ).rejects.toMatchObject({ code: 'last_access_method' });
  });
});
it('binds a legacy restricted principal by its method reference when no separate grant field exists', async () => {
  const f = storage([[user], [session], [flow], [flow]]);

  await expect(lockIdentity(f.tx, session.sid, { ...granted, grantId: undefined })).resolves.toMatchObject({
    id: user.id,
  });
});
