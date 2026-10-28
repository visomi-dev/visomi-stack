import { AuthMail } from '@visomi-stack/backend-shared';
import { expect, it } from 'vitest';

import { config, flow, quietMail, session, storage } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { Flows } from '../shared/flows';

it('rejects a proof lost between reservation and locked consumption', async () => {
  const f = storage([[session], []]);
  const proofs = authService(Flows, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  await expect(proofs.locked(f.tx, session.sid, flow.id)).rejects.toMatchObject({ code: 'verification_failed' });

  const lost = storage([[]]);

  await expect(
    authService(Flows, lost.db, config, [{ provide: AuthMail, useValue: quietMail }]).consume(lost.tx, flow),
  ).rejects.toMatchObject({
    code: 'verification_failed',
  });

  const limited = storage([[{ attempts: 11 }]]);

  await expect(
    authService(Flows, limited.db, config, [{ provide: AuthMail, useValue: quietMail }]).limit('synthetic', 'identity'),
  ).rejects.toMatchObject({
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

    await expect(
      authService(Flows, f.db, config, [{ provide: AuthMail, useValue: quietMail }]).resend(session.sid, flow.id),
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
  }
});
