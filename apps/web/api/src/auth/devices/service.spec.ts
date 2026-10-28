import { describe, expect, it, vi } from 'vitest';

import { config, current, flow, granted, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { Recovery, completeEnrollment } from '../recovery/service';
import { Flows, type Flow } from '../shared/flows';
import { digest } from '../shared/secrets';
import { Factors } from '../totp/service';

import { Devices, validateApproval } from './service';

describe('device approval revocation and races', () => {
  const request = {
    id: flow.id,
    sessionId: session.sid,
    email: user.email,
    userId: user.id,
    approverSessionId: 'approver',
    approver: { method: 'password', version: 1, authenticatedAt: Date.now() },
    status: 'approved',
    codeHash: digest(config.secret, `device:${flow.id}`, '123456'),
    expiresAt: flow.expiresAt,
  };

  it('rejects missing, revoked and stale approval authorities', async () => {
    for (const candidate of [
      undefined,
      { ...request, approver: null },
      { ...request, status: 'denied' },
      { ...request, approver: { ...request.approver, version: 2 } },
    ]) {
      const f = storage([candidate ? [candidate] : []]);

      await expect(validateApproval(f.tx, flow.id, user.id, 1)).rejects.toMatchObject({ code: 'verification_failed' });
    }
    const gone = storage([[request], []]);

    await expect(validateApproval(gone.tx, flow.id, user.id, 1)).rejects.toMatchObject({ code: 'verification_failed' });
    const revoked = storage([
      [{ ...request, approver: { ...request.approver, method: 'google', methodId: 'revoked' } }],
      [session],
      [],
    ]);

    await expect(validateApproval(revoked.tx, flow.id, user.id, 1)).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });
  it('rejects wrong pairing codes, mismatched owners and races with a previous decision', async () => {
    const proofs = {} as Flows;

    for (const result of [[], [{ ...request, codeHash: 'different' }]]) {
      const f = storage([result]);

      await expect(
        authService(Devices, f.db, config, [
          { provide: Flows, useValue: { limit: vi.fn() } as unknown as Flows },
        ]).decide('approver', current, flow.id, true, '123456'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
    const mismatch = storage([[request], [{ ...user, email: 'other@example.test' }], [session]]);

    await expect(
      authService(Devices, mismatch.db, config, [
        { provide: Flows, useValue: { limit: vi.fn() } as unknown as Flows },
      ]).decide('approver', current, flow.id, true, '123456'),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const raced = storage([[request], [user], [session], []]);

    await expect(
      authService(Devices, raced.db, config, [
        { provide: Flows, useValue: { limit: vi.fn() } as unknown as Flows },
      ]).decide('approver', current, flow.id, true, '123456'),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const cancelled = storage([[session], []]);

    await expect(
      authService(Devices, cancelled.db, config, [{ provide: Flows, useValue: proofs }]).cancel(session.sid, flow.id),
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });
  it('rejects another reviewer, a deleted user and an already consumed approval', async () => {
    const missing = storage([[user], [session], []]);

    await expect(
      authService(Devices, missing.db, config, [{ provide: Flows, useValue: {} as Flows }]).review(
        'approver',
        current,
        flow.id,
      ),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const self = storage([[user], [session], [request]]);

    await expect(
      authService(Devices, self.db, config, [{ provide: Flows, useValue: {} as Flows }]).review(
        session.sid,
        current,
        flow.id,
      ),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const gone = storage([[request], [], [session]]);

    await expect(
      authService(Devices, gone.db, config, [{ provide: Flows, useValue: {} as Flows }]).consume(
        session.sid,
        flow.id,
        '123456',
      ),
    ).rejects.toMatchObject({ code: 'verification_failed' });
    const race = storage([[request], [user], [session], [request], [session], []]);

    await expect(
      authService(Devices, race.db, config, [{ provide: Flows, useValue: {} as Flows }]).consume(
        session.sid,
        flow.id,
        '123456',
      ),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

describe('restricted enrollment guards', () => {
  it.each([{ userId: 'other' }, { authVersion: 2 }, { data: {} }, { purpose: 'recovery' }])(
    'rejects enrollment with invalid authority %j',
    async (change) => {
      const f = storage();

      await expect(
        completeEnrollment(f.tx, user, { ...flow, ...change } as Flow, session.sid, 'passkey', 'key'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    },
  );
  it('does not move a missing or already invalidated grant into a new session', async () => {
    const f = storage([[session], []]);
    const recovery = authService(Recovery, f.db, config, [
      { provide: Flows, useValue: {} as Flows },
      { provide: Factors, useValue: {} as Factors },
    ]);

    await expect(recovery.bindGrant('previous', session.sid, current)).resolves.toBeUndefined();
    await expect(recovery.bindGrant('previous', session.sid, granted)).rejects.toMatchObject({
      code: 'verification_failed',
    });
    await expect(recovery.password(session.sid, current, 'Synthetic password 42!')).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });
});
