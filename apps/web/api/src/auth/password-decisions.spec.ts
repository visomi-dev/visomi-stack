import { AuthMail } from '@visomi-stack/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { authService } from '../../tests/support/injection';
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

import { Accounts } from './accounts';
import { Factors } from './factors';
import { Flows, type Flow } from './flows';
import { Recovery } from './recovery';
import { hashPassword } from './secrets';

describe('password and email proof version binding', () => {
  function accounts(results: unknown[], pending: Flow) {
    const f = storage(results);
    const account = authService(Accounts, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

    vi.spyOn(account.flows, 'reserve').mockResolvedValue(pending);
    vi.spyOn(account.flows, 'locked').mockResolvedValue(pending);
    vi.spyOn(account.flows, 'code').mockReturnValue(undefined);
    vi.spyOn(account.flows, 'consume').mockResolvedValue(undefined);

    return { ...f, account };
  }
  const login = { ...flow, purpose: 'password_login' as const, data: { requiredFactor: 'email' as const } };

  it('rejects mismatched purpose, user version, password and email before consuming a factor', async () => {
    for (const invalid of [
      { ...flow, purpose: 'recovery' as const },
      { ...flow, purpose: 'email_verify' as const },
    ]) {
      const f = accounts([], invalid);

      await expect(
        f.account.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
    for (const candidate of [
      undefined,
      { ...user, authVersion: 2 },
      { ...user, passwordHash: null },
      { ...user, email: 'other@example.test' },
    ]) {
      const f = accounts([candidate ? [candidate] : []], login);

      await expect(
        f.account.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
    const policy = accounts([[user], [factor]], login);

    await expect(
      policy.account.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const wrong = accounts([[user], []], login);

    await expect(
      wrong.account.loginComplete(session.sid, flow.id, { kind: 'totp', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
  it('rejects foreign email verification, switching an unverified address, and missing reauth identities', async () => {
    const pending = { ...flow, purpose: 'email_verify' as const, userId: 'other' };
    const f = accounts([[], [user], [session]], pending);

    await expect(f.account.emailComplete(session.sid, current, flow.id, '123456')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const change = accounts([[{ attempts: 1 }], [user], [session]], flow);

    await expect(
      change.account.emailStart(session.sid, { ...current, level: 'unverified' }, 'other@example.test'),
    ).rejects.toMatchObject({ code: 'email_change_required' });
    const missing = accounts([[{ attempts: 1 }], []], flow);

    await expect(missing.account.reauthStart(session.sid, current, 'Synthetic password!')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const result1 = await missing.account.notify(null, 'password_changed');

    expect(result1).toBe(false);
  });
  it('rejects reauthentication after another security change or factor replacement', async () => {
    const f = accounts([[user], [session]], { ...flow, userId: 'other' });

    await expect(
      f.account.reauthComplete(session.sid, current, flow.id, { kind: 'email', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const changed = accounts([[user], [session], [factor]], {
      ...flow,
      data: { requiredFactor: 'totp', factorId: 'other-factor' },
    });

    await expect(
      changed.account.reauthComplete(session.sid, current, flow.id, { kind: 'totp', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const removed = accounts([[user], [session], []], { ...flow, data: { requiredFactor: 'totp' } });

    await expect(
      removed.account.reauthComplete(session.sid, current, flow.id, { kind: 'email', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

describe('recovery proof binding', () => {
  function recovery(results: unknown[], pending: Flow) {
    const f = storage(results);
    const proofs = {
      reserve: vi.fn().mockResolvedValue(pending),
      locked: vi.fn().mockResolvedValue(pending),
      code: vi.fn(),
      consume: vi.fn().mockResolvedValue(undefined),
    };
    const factors = { active: vi.fn().mockResolvedValue(undefined), verify: vi.fn() };
    const recovery = authService(Recovery, f.db, config, [
      { provide: Flows, useValue: proofs as unknown as Flows },
      { provide: Factors, useValue: factors as unknown as Factors },
    ]);

    return { ...f, proofs, factors, recovery };
  }
  it('rejects recovery after a user, email, password or second-factor change', async () => {
    for (const candidate of [
      undefined,
      { ...user, emailVerifiedAt: null },
      { ...user, email: 'other@example.test' },
      { ...user, authVersion: 2 },
    ]) {
      const f = recovery([candidate ? [candidate] : []], { ...flow, purpose: 'recovery' });

      await expect(f.recovery.verify(session.sid, flow.id, '123456')).rejects.toMatchObject({
        code: 'verification_failed',
      });
    }
    const changed = recovery([[user]], {
      ...flow,
      purpose: 'recovery',
      data: { requiredFactor: 'totp', factorId: 'old' },
    });

    changed.factors.active.mockResolvedValue(factor as never);
    await expect(changed.recovery.verify(session.sid, flow.id, '123456')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const removed = recovery([[{ ...user, passwordHash: null }]], { ...flow, purpose: 'password_reset' });

    await expect(
      removed.recovery.verify(session.sid, flow.id, '123456', undefined, 'Synthetic new password!'),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
  it('does not enroll a password with a changed grant or without a restricted authority', async () => {
    const f = recovery([[user], [session], [flow], [flow]], { ...flow, userId: 'other' });

    await expect(f.recovery.password(session.sid, granted, 'Synthetic new password!')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    await expect(
      f.recovery.password(session.sid, { ...granted, level: undefined }, 'Synthetic new password!'),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
  it('checks replacement-password proofs before consuming their second factor', async () => {
    const password = 'Synthetic replacement password!';
    const passwordHash = await hashPassword(password);
    const grant = { ...flow, data: { factorProven: true, passwordHash } };
    const proof = { ...flow, id: 'proof', data: { methodId: flow.id, requiredFactor: 'email' as const } };

    for (const invalid of [
      { ...proof, userId: 'other' },
      { ...proof, authVersion: 2 },
      { ...proof, data: { methodId: 'other' } },
    ]) {
      const f = recovery([[user], [session], [flow], [flow]], flow);

      f.proofs.locked.mockResolvedValueOnce(grant).mockResolvedValueOnce(invalid);
      await expect(
        f.recovery.passwordComplete(session.sid, granted, 'proof', password, { kind: 'email', code: '123456' }),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
    for (const active of [undefined, factor]) {
      const f = recovery([[user], [session], [flow], [flow]], flow);

      f.proofs.locked.mockResolvedValueOnce(grant).mockResolvedValueOnce(proof);
      f.factors.active.mockResolvedValue(active as never);
      await expect(
        f.recovery.passwordComplete(session.sid, granted, 'proof', password, { kind: 'totp', code: '123456' }),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
  });
});

it('rejects claiming an unverified duplicate after another identity verified its email', async () => {
  const pending = {
    ...flow,
    purpose: 'email_verify' as const,
    data: { method: 'password' as const, requiredFactor: 'email' as const },
  };
  const f = storage([[], [{ ...user, emailVerifiedAt: null }], [], [user]]);
  const account = authService(Accounts, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  vi.spyOn(account.flows, 'reserve').mockResolvedValue(pending);
  vi.spyOn(account.flows, 'locked').mockResolvedValue(pending);
  vi.spyOn(account.flows, 'code').mockReturnValue(undefined);
  await expect(account.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' })).rejects.toMatchObject({
    code: 'email_in_use',
  });
});
