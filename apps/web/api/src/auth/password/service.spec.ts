import { AuthMail } from '@visomi-stack/backend-shared';
import { expect, it, vi } from 'vitest';

import { config, current, factor, flow, quietMail, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { Passwords } from '../password/service';
import { type Flow } from '../shared/flows';

function passwords(results: unknown[], pending: Flow) {
  const f = storage(results);
  const passwords = authService(Passwords, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  vi.spyOn(passwords.flows, 'reserve').mockResolvedValue(pending);
  vi.spyOn(passwords.flows, 'locked').mockResolvedValue(pending);
  vi.spyOn(passwords.flows, 'code').mockReturnValue(undefined);
  vi.spyOn(passwords.flows, 'consume').mockResolvedValue(undefined);

  return { ...f, passwords };
}
const login = { ...flow, purpose: 'password_login' as const, data: { requiredFactor: 'email' as const } };

it('rejects mismatched purpose, user version, password and email before consuming a factor', async () => {
  for (const invalid of [
    { ...flow, purpose: 'recovery' as const },
    { ...flow, purpose: 'email_verify' as const },
  ]) {
    const f = passwords([], invalid);

    await expect(
      f.passwords.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  }
  for (const candidate of [
    undefined,
    { ...user, authVersion: 2 },
    { ...user, passwordHash: null },
    { ...user, email: 'other@example.test' },
  ]) {
    const f = passwords([candidate ? [candidate] : []], login);

    await expect(
      f.passwords.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  }
  const policy = passwords([[user], [factor]], login);

  await expect(
    policy.passwords.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
  const wrong = passwords([[user], []], login);

  await expect(
    wrong.passwords.loginComplete(session.sid, flow.id, { kind: 'totp', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
});
it('rejects reauthentication after another security change or factor replacement', async () => {
  const f = passwords([[user], [session]], { ...flow, userId: 'other' });

  await expect(
    f.passwords.reauthComplete(session.sid, current, flow.id, { kind: 'email', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
  const changed = passwords([[user], [session], [factor]], {
    ...flow,
    data: { requiredFactor: 'totp', factorId: 'other-factor' },
  });

  await expect(
    changed.passwords.reauthComplete(session.sid, current, flow.id, { kind: 'totp', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
  const removed = passwords([[user], [session], []], { ...flow, data: { requiredFactor: 'totp' } });

  await expect(
    removed.passwords.reauthComplete(session.sid, current, flow.id, { kind: 'email', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
});
it('rejects claiming an unverified duplicate after another identity verified its email', async () => {
  const pending = {
    ...flow,
    purpose: 'email_verify' as const,
    data: { method: 'password' as const, requiredFactor: 'email' as const },
  };
  const f = storage([[], [{ ...user, emailVerifiedAt: null }], [], [user]]);
  const account = authService(Passwords, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  vi.spyOn(account.flows, 'reserve').mockResolvedValue(pending);
  vi.spyOn(account.flows, 'locked').mockResolvedValue(pending);
  vi.spyOn(account.flows, 'code').mockReturnValue(undefined);
  await expect(account.loginComplete(session.sid, flow.id, { kind: 'email', code: '123456' })).rejects.toMatchObject({
    code: 'email_in_use',
  });
});
it('rejects a missing reauthentication identity', async () => {
  const missing = passwords([[{ attempts: 1 }], []], flow);

  await expect(missing.passwords.reauthStart(session.sid, current, 'Synthetic password!')).rejects.toMatchObject({
    code: 'verification_failed',
  });
});
