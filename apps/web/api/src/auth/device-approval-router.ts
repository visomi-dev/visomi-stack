import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { and, eq, gt, isNull, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
import { FLOW_TTL_MS, requestContext } from './auth-route-session';
import { approvalCreateSchema, approvalIdSchema, approvalConsumeSchema } from './auth-schemas';
import { clientContextHash } from './auth-service';
import { csrfProtection, authenticationRateLimit } from './passkey-security';

import { HttpError, httpResponse, authAuditEvents, authDeviceApprovalRequests, authEnrollmentGrants, db } from 'shared';

export const deviceApprovalRouter = Router();

function approvalStatus(request: typeof authDeviceApprovalRequests.$inferSelect) {
  if (request.consumedAt) {
    return 'consumed' as const;
  }
  if (request.cancelledAt) {
    return 'cancelled' as const;
  }
  if (request.deniedAt) {
    return 'denied' as const;
  }
  if (request.expiresAt <= DateTime.utc().toJSDate()) {
    return 'expired' as const;
  }

  return request.approvedAt ? ('approved' as const) : ('pending' as const);
}

deviceApprovalRouter.post(
  '/device-approval/request',
  csrfProtection,
  authed(),
  authenticationRateLimit,
  validateRequest({ body: approvalCreateSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { accountId } = getValidated<{ body: typeof approvalCreateSchema }>(req).body!;

    if (current.accountId !== accountId) {
      throw new HttpError({ code: 'account_unavailable', message: 'The account is not available.', statusCode: 404 });
    }
    const userCode = generateVerificationPin();
    const now = DateTime.utc();
    const requestId = randomUUID();
    const userCodeHash = await hashSecret(userCode);

    await db.insert(authDeviceApprovalRequests).values({
      id: requestId,
      userCodeHash,
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      userId: current.id,
      accountId,
      expiresAt: now.plus({ minutes: 10 }).toJSDate(),
      createdAt: now.toJSDate(),
      updatedAt: now.toJSDate(),
    });
    httpResponse.json(res, {
      data: { requestId, userCode, expiresAt: now.plus({ minutes: 10 }).toJSDate().toISOString() },
      status: 201,
      message: 'Device approval request created.',
    });
  },
);

deviceApprovalRouter.post(
  '/device-approval/status',
  csrfProtection,
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [request] = await db
      .select()
      .from(authDeviceApprovalRequests)
      .where(eq(authDeviceApprovalRequests.id, requestId))
      .limit(1);

    if (!request || request.requesterSessionHash !== clientContextHash(req.sessionID, req.get('user-agent'))) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 410,
      });
    }
    httpResponse.json(res, {
      data: { requestId, status: approvalStatus(request), expiresAt: request.expiresAt.toISOString() },
      message: 'Device approval status retrieved.',
    });
  },
);

deviceApprovalRouter.post(
  '/device-approval/approve',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const current = authedRequest(req).user;

    if (
      !req.session.passkeySecurityReauthenticatedAt ||
      DateTime.utc().toMillis() - req.session.passkeySecurityReauthenticatedAt > 10 * 60_000
    ) {
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'Confirm an existing passkey before approving a device.',
        statusCode: 401,
      });
    }
    const [approved] = await db
      .update(authDeviceApprovalRequests)
      .set({
        approvedAt: DateTime.utc().toJSDate(),
        approvalCredentialId: current.credentialId ?? null,
        updatedAt: DateTime.utc().toJSDate(),
      })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
          eq(authDeviceApprovalRequests.userId, current.id),
          ne(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          gt(authDeviceApprovalRequests.expiresAt, DateTime.utc().toJSDate()),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNull(authDeviceApprovalRequests.approvedAt),
          isNull(authDeviceApprovalRequests.consumedAt),
        ),
      )
      .returning();

    if (!approved) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    }
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'device_approval',
      outcome: 'accepted',
      userId: current.id,
      accountId: current.accountId,
      contextHash: requestContext(req),
      createdAt: DateTime.utc().toJSDate(),
    });
    httpResponse.json(res, { data: { requestId, status: 'approved' }, message: 'Device approved.' });
  },
);

deviceApprovalRouter.post(
  '/device-approval/review',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [request] = await db
      .select()
      .from(authDeviceApprovalRequests)
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.userId, current.id),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
        ),
      )
      .limit(1);

    if (!request) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 404,
      });
    }
    httpResponse.json(res, {
      data: {
        requestId,
        status: approvalStatus(request),
        accountId: current.accountId,
        createdAt: request.createdAt.toISOString(),
        expiresAt: request.expiresAt.toISOString(),
        requester: request.requesterSessionHash === clientContextHash(req.sessionID, req.get('user-agent')),
      },
      message: 'Approval request reviewed.',
    });
  },
);

deviceApprovalRouter.post(
  '/device-approval/cancel',
  csrfProtection,
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [cancelled] = await db
      .update(authDeviceApprovalRequests)
      .set({ cancelledAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.consumedAt),
          gt(authDeviceApprovalRequests.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .returning();

    if (!cancelled) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    }
    httpResponse.json(res, { data: { requestId, status: 'cancelled' }, message: 'Approval request cancelled.' });
  },
);

deviceApprovalRouter.post(
  '/device-approval/deny',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const current = authedRequest(req).user;
    const [denied] = await db
      .update(authDeviceApprovalRequests)
      .set({ deniedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.userId, current.id),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
          ne(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.approvedAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNull(authDeviceApprovalRequests.consumedAt),
          gt(authDeviceApprovalRequests.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .returning();

    if (!denied) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    }
    httpResponse.json(res, { data: { requestId, status: 'denied' }, message: 'Approval request denied.' });
  },
);

deviceApprovalRouter.post(
  '/device-approval/consume',
  csrfProtection,
  authenticationRateLimit,
  validateRequest({ body: approvalConsumeSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof approvalConsumeSchema }>(req).body!;
    const [request] = await db
      .update(authDeviceApprovalRequests)
      .set({ attemptCount: sql`${authDeviceApprovalRequests.attemptCount} + 1`, updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, body.requestId),
          eq(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.consumedAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNotNull(authDeviceApprovalRequests.approvedAt),
          gt(authDeviceApprovalRequests.expiresAt, DateTime.utc().toJSDate()),
          lt(authDeviceApprovalRequests.attemptCount, 5),
        ),
      )
      .returning();

    if (!request || !request.approvedAt || request.expiresAt <= DateTime.utc().toJSDate()) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 401,
      });
    }
    const valid = await verifySecret(body.userCode, request.userCodeHash);

    if (!valid) {
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 401,
      });
    }
    const grant = await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(authDeviceApprovalRequests)
        .set({ consumedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
        .where(
          and(
            eq(authDeviceApprovalRequests.id, request.id),
            isNull(authDeviceApprovalRequests.consumedAt),
            isNull(authDeviceApprovalRequests.deniedAt),
            isNull(authDeviceApprovalRequests.cancelledAt),
            gt(authDeviceApprovalRequests.expiresAt, DateTime.utc().toJSDate()),
          ),
        )
        .returning();

      if (!consumed) {
        throw new HttpError({
          code: 'approval_replayed',
          message: 'The approval request was already consumed.',
          statusCode: 409,
        });
      }
      const [createdGrant] = await tx
        .insert(authEnrollmentGrants)
        .values({
          id: randomUUID(),
          userId: request.userId,
          accountId: request.accountId,
          requesterSessionHash: request.requesterSessionHash,
          source: 'device_approval',
          expiresAt: DateTime.utc().plus({ milliseconds: FLOW_TTL_MS }).toJSDate(),
          createdAt: DateTime.utc().toJSDate(),
        })
        .returning();

      return createdGrant;
    });

    req.session.enrollmentGrantId = grant?.id;
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'device_approval_consumed',
      outcome: 'accepted',
      userId: request.userId,
      accountId: request.accountId,
      contextHash: request.requesterSessionHash,
      createdAt: DateTime.utc().toJSDate(),
    });
    httpResponse.json(res, {
      data: { requestId: request.id, accountId: request.accountId, userId: request.userId, grant: 'enrollment' },
      message: 'Device approval consumed.',
    });
  },
);
