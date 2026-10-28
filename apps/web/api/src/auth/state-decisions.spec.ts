import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';

import {
  config,
  current,
  factor,
  flow,
  granted,
  quietMail,
  session,
  storage,
  user,
} from '../../tests/support/auth-state';

import { Factors } from './factors';
import { Flows } from './flows';
import { activeMethod, lastMethod, lockIdentity, principal, readPrincipal } from './identity';
import { decryptSecret, digest } from './secrets';

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

describe('atomic proof and factor consumption', () => {
  it('rejects a proof lost between reservation and locked consumption', async () => {
    const f = storage([[session], []]);
    const proofs = new Flows(f.db, config, quietMail);

    await expect(proofs.locked(f.tx, session.sid, flow.id)).rejects.toMatchObject({ code: 'verification_failed' });
    const lost = storage([[]]);

    await expect(new Flows(lost.db, config, quietMail).consume(lost.tx, flow)).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const limited = storage([[{ attempts: 11 }]]);

    await expect(new Flows(limited.db, config, quietMail).limit('synthetic', 'identity')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
  it('refuses code resend when the flow has no deliverable email, is exhausted, or requires TOTP', async () => {
    for (const changed of [
      { email: null },
      { codeHash: null },
      { attempts: 5 },
      { purpose: 'password_login', data: { requiredFactor: 'totp' } },
      { purpose: 'enrollment' },
    ]) {
      const state = { ...flow, purpose: 'email_verify', codeHash: 'synthetic', ...changed };
      const f = storage([[{ attempts: 1 }], [session], [state]]);

      await expect(new Flows(f.db, config, quietMail).resend(session.sid, flow.id)).rejects.toMatchObject({
        code: 'verification_failed',
      });
    }
  });
  it('requires an active factor and its dedicated encryption key', async () => {
    const missing = storage([[]]);

    await expect(
      new Factors(missing.db, config).verify(missing.tx, user, { kind: 'totp', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const absentKey = { ...config, totpKey: undefined };
    const f = storage([[factor]]);

    await expect(
      new Factors(f.db, absentKey).verify(f.tx, user, { kind: 'totp', code: '123456' }),
    ).rejects.toMatchObject({ code: 'totp_unavailable' });
    await expect(new Factors(f.db, absentKey).setup(session.sid, current)).rejects.toMatchObject({
      code: 'totp_unavailable',
    });
  });
  it('rejects an invalid pending TOTP proof and a backup consumed by another request', async () => {
    const f = storage([
      [user],
      [session],
      [{ ...factor, authVersion: 1, sessionId: session.sid, expiresAt: flow.expiresAt }],
    ]);

    await expect(new Factors(f.db, config).confirm(session.sid, current, flow.id, 'invalid')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const code = 'SYNTHETIC';
    const race = storage([
      [factor],
      [{ id: 'backup', codeHash: digest(config.secret, `backup:${user.id}`, code) }],
      [],
    ]);

    await expect(
      new Factors(race.db, config).verify(race.tx, user, { kind: 'recovery_code', code }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

it('accepts a fresh TOTP proof and advances its replay barrier', async () => {
  const secret = decryptSecret(factor.encryptedSecret, config.totpKey!);
  const code = await generate({ secret });
  const f = storage([[factor], []]);

  await expect(new Factors(f.db, config).verify(f.tx, user, { kind: 'totp', code })).resolves.toBeUndefined();
});

it('binds a legacy restricted principal by its method reference when no separate grant field exists', async () => {
  const f = storage([[user], [session], [flow], [flow]]);

  await expect(lockIdentity(f.tx, session.sid, { ...granted, grantId: undefined })).resolves.toMatchObject({
    id: user.id,
  });
});
