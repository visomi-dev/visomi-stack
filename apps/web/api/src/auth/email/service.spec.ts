import { AuthMail } from '@visomi-stack/backend-shared';
import { expect, it, vi } from 'vitest';

import { config, current, flow, quietMail, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { EmailIdentity } from '../email/service';

it('rejects foreign verification and switching an unverified address', async () => {
  const pending = { ...flow, purpose: 'email_verify' as const, userId: 'other' };
  const f = storage([[], [user], [session]]);
  const email = authService(EmailIdentity, f.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  vi.spyOn(email.flows, 'reserve').mockResolvedValue(pending);
  vi.spyOn(email.flows, 'locked').mockResolvedValue(pending);
  await expect(email.emailComplete(session.sid, current, flow.id, '123456')).rejects.toMatchObject({
    code: 'verification_failed',
  });
  const change = storage([[{ attempts: 1 }], [user], [session]]);
  const changing = authService(EmailIdentity, change.db, config, [{ provide: AuthMail, useValue: quietMail }]);

  await expect(
    changing.emailStart(session.sid, { ...current, level: 'unverified' }, 'other@example.test'),
  ).rejects.toMatchObject({ code: 'email_change_required' });
});
