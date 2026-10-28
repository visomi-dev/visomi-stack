import { describe, expect, it, vi } from 'vitest';

import { config, factor, flow, granted, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { hashPassword } from '../password/crypto';
import { Recovery } from '../recovery/service';
import { Flows, type Flow } from '../shared/flows';
import { Factors } from '../totp/service';

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
