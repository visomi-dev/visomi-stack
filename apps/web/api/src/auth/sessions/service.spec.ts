import { REALTIME_PUBLISHER } from '@visomi-stack/backend-shared';
import { expect, it, vi } from 'vitest';

import { config, current, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';

import { Sessions } from './service';

it('publishes only for sessions that were revoked, even if delivery fails', async () => {
  const other = { sid: 'synthetic-other-session' };
  const state = storage([[user], [session], [session, other], []]);
  const notifySession = vi.fn().mockRejectedValue(new Error('synthetic_delivery_failure'));
  const sessions = authService(Sessions, state.db, config, [
    { provide: REALTIME_PUBLISHER, useValue: { notifySession } },
  ]);

  await expect(sessions.closeSessions(session.sid, current)).resolves.toBe(false);

  expect(notifySession).toHaveBeenCalledExactlyOnceWith(other.sid);
});
