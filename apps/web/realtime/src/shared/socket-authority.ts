import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { z } from 'zod';

import { hasOperationMembership, isSessionAuthorityStore } from 'shared';
import type { OperationOwner } from 'shared';

const identity = z.object({
  authority: z.literal('full'),
  passport: z.object({
    user: z.object({ id: z.uuid(), accountId: z.uuid(), authVersion: z.number().int().positive() }),
  }),
});

/** Reload persisted authority on delivery and hold it until emission completes. */
export async function withCurrentSocketOwner(
  socket: Socket,
  deliver: (owner: OperationOwner) => Promise<void>,
): Promise<void> {
  const request = socket.request as Request;

  await new Promise<void>((resolve, reject) => request.session.reload((error) => (error ? reject(error) : resolve())));
  const { passport } = identity.parse(request.session);
  const user = passport.user;

  if (!isSessionAuthorityStore(request.sessionStore)) throw new Error('Session authority is unavailable.');
  await request.sessionStore.withSessionAuthority(
    {
      userId: user.id,
      authVersion: user.authVersion,
      currentSid: request.sessionID,
      authority: 'full',
    },
    async () => {
      // A scope can change while this delivery waits for the authority lease.
      await new Promise<void>((resolve, reject) =>
        request.session.reload((error) => (error ? reject(error) : resolve())),
      );
      const current = identity.parse(request.session).passport.user;

      if (current.id !== user.id || current.authVersion !== user.authVersion || current.accountId !== user.accountId) {
        throw new Error('Socket scope changed.');
      }
      const owner = {
        sessionId: request.sessionID,
        userId: user.id,
        accountId: user.accountId,
        authVersion: user.authVersion,
      };

      if (!(await hasOperationMembership(owner))) throw new Error('Socket authority was revoked.');
      await deliver(owner);
    },
  );
}
