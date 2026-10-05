import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { clientContextHash } from './auth-service';

import { authIdentityFlows, db, HttpError, regenerateSession } from 'shared';

export const FLOW_TTL_MS = 15 * 60_000;

/** Shared session transitions used by identity and password route groups. */
export function requestContext(req: Request): string {
  return clientContextHash(req.ip, req.get('user-agent'));
}

export async function identityFlow(req: Request, id: string) {
  const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, id)).limit(1);

  if (
    !flow ||
    flow.sessionBinding !== req.sessionID ||
    flow.expiresAt <= DateTime.utc().toJSDate() ||
    flow.terminalAt
  ) {
    throw new HttpError({
      code: 'identity_flow_unavailable',
      message: 'The identity flow is no longer available.',
      statusCode: 410,
    });
  }

  return flow;
}

export async function bindPasswordFlowToNewSession(req: Request, flowId: string): Promise<void> {
  await regenerateSession(req);
  await db
    .update(authIdentityFlows)
    .set({ sessionBinding: req.sessionID, updatedAt: DateTime.utc().toJSDate() })
    .where(eq(authIdentityFlows.id, flowId));
}

export function restrictedSession(req: Request) {
  const restricted = req.session?.restrictedAuth;

  if (!restricted || restricted.expiresAt <= DateTime.utc().toMillis()) {
    if (restricted) {
      delete req.session.restrictedAuth;
    }
    throw new HttpError({
      code: 'restricted_session_required',
      message: 'Verify an email code before continuing.',
      statusCode: 401,
    });
  }

  return restricted;
}
