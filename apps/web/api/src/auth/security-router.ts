import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { removeAccessMethod } from './access-methods';
import { authed, authedRequest } from './auth-middleware';
import { requestContext } from './auth-route-session';
import {
  operationGrantSchema,
  passwordRemoveSchema,
  passwordVerifySchema,
  securityDevicePathSchema,
  securityIdentityPathSchema,
} from './auth-schemas';
import { clientContextHash } from './auth-service';
import { startPasswordSignIn, verifyPasswordEmailOtp, verifyPasswordTotp } from './password-session';
import { authenticationRateLimit, csrfProtection } from './passkey-security';
import { securityMethods } from './security-methods';

import {
  accountPasskeyCredentials,
  authAuditEvents,
  authEnrollmentGrants,
  authIdentityFlows,
  db,
  HttpError,
  httpResponse,
  userDevices,
  userFederatedIdentities,
} from 'shared';

export const securityRouter = Router();

securityRouter.post(
  '/passkey/enrollment/identity',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'passkey_enroll', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const grantId = randomUUID();

    await db.insert(authEnrollmentGrants).values({
      id: grantId,
      userId: current.id,
      accountId: current.accountId,
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      source: 'identity_enrollment',
      expiresAt: DateTime.utc().plus({ minutes: 5 }).toJSDate(),
      createdAt: DateTime.utc().toJSDate(),
    });
    req.session.enrollmentGrantId = grantId;
    httpResponse.json(res, { data: { authorized: true }, message: 'Passkey enrollment authorized.' });
  },
);

securityRouter.post(
  '/passkey/enrollment/start',
  csrfProtection,
  authed({ authority: 'full' }),
  authenticationRateLimit,
  validateRequest({ body: passwordRemoveSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const available = await securityMethods(current.id, current.accountId);

    if (available.methods.includes('passkey')) {
      throw new HttpError({
        code: 'existing_passkey_required',
        message: 'Confirm an existing passkey to add another.',
        statusCode: 409,
      });
    }
    const pending = await startPasswordSignIn(
      current.email,
      req.body.currentPassword,
      requestContext(req),
      req.sessionID,
      req.ip,
    );

    if (req.session.passkeyEnrollmentFlowId) {
      await db
        .update(authIdentityFlows)
        .set({ terminalAt: DateTime.utc().toJSDate() })
        .where(
          and(eq(authIdentityFlows.id, req.session.passkeyEnrollmentFlowId), eq(authIdentityFlows.userId, current.id)),
        );
    }
    await db
      .update(authIdentityFlows)
      .set({ intent: 'passkey_enroll', accountId: current.accountId })
      .where(eq(authIdentityFlows.id, pending.flowId));
    req.session.passkeyEnrollmentFlowId = pending.flowId;
    httpResponse.json(res, {
      data: pending,
      status: 202,
      message: 'Confirm the selected factor before enrolling your first passkey.',
    });
  },
);

securityRouter.post(
  '/passkey/enrollment/complete',
  csrfProtection,
  authed({ authority: 'full' }),
  authenticationRateLimit,
  validateRequest({ body: passwordVerifySchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof passwordVerifySchema }>(req).body!;
    const [flow] = await db
      .select()
      .from(authIdentityFlows)
      .where(
        and(
          eq(authIdentityFlows.id, body.flowId),
          eq(authIdentityFlows.userId, current.id),
          eq(authIdentityFlows.accountId, current.accountId),
          eq(authIdentityFlows.intent, 'passkey_enroll'),
          eq(authIdentityFlows.sessionBinding, req.sessionID),
          gt(authIdentityFlows.expiresAt, DateTime.utc().toJSDate()),
          isNull(authIdentityFlows.completedAt),
          isNull(authIdentityFlows.terminalAt),
        ),
      )
      .limit(1);

    if (!flow || req.session.passkeyEnrollmentFlowId !== body.flowId || flow.requiredFactor !== body.kind) {
      throw new HttpError({
        code: 'verification_failed',
        message: 'This enrollment verification is unavailable.',
        statusCode: 401,
      });
    }
    const verification =
      body.kind === 'email'
        ? verifyPasswordEmailOtp(body.flowId, body.code, requestContext(req), req.sessionID)
        : verifyPasswordTotp(body.flowId, body.code, req.sessionID);
    const verified = await verification;

    if (verified.user.id !== current.id || verified.user.authVersion !== current.authVersion) {
      throw new HttpError({
        code: 'verification_failed',
        message: 'Confirm your current identity again.',
        statusCode: 401,
      });
    }
    const grantId = randomUUID();

    await db.insert(authEnrollmentGrants).values({
      id: grantId,
      userId: current.id,
      accountId: current.accountId,
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      source: 'password_enrollment',
      expiresAt: DateTime.utc().plus({ minutes: 5 }).toJSDate(),
      createdAt: DateTime.utc().toJSDate(),
    });
    req.session.enrollmentGrantId = grantId;
    delete req.session.passkeyEnrollmentFlowId;
    httpResponse.json(res, { data: { authorized: true }, message: 'First-passkey enrollment authorized.' });
  },
);

securityRouter.get('/security/overview', authed({ authority: 'full' }), async (req, res) => {
  const current = authedRequest(req).user;
  const available = await securityMethods(current.id, current.accountId);
  const [credentials, federated, devices, audit] = await Promise.all([
    db
      .select()
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, current.id),
          eq(accountPasskeyCredentials.accountId, current.accountId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      ),
    db
      .select()
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.userId, current.id), isNull(userFederatedIdentities.revokedAt))),
    db
      .select()
      .from(userDevices)
      .where(and(eq(userDevices.userId, current.id), gt(userDevices.expiresAt, DateTime.utc().toJSDate()))),
    db
      .select()
      .from(authAuditEvents)
      .where(and(eq(authAuditEvents.userId, current.id), eq(authAuditEvents.accountId, current.accountId))),
  ]);

  httpResponse.json(res, {
    data: {
      passwordEnabled: available.passwordEnabled,
      googleLinkEnabled: Boolean(env.GOOGLE_AUTH_CLIENT_ID),
      totpEnabled: available.totpEnabled,
      recoveryCodesRemaining: available.recoveryCodesRemaining,
      passkeys: credentials.map((item) => ({
        id: item.credentialId,
        label: item.label,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      })),
      federatedIdentities: federated.map((item) => ({
        id: item.id,
        provider: item.provider,
        emailAtLink: item.emailAtLink,
        linkedAt: item.linkedAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      })),
      trustedDevices: devices.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
        expiresAt: item.expiresAt.toISOString(),
      })),
      recoveryEvents: audit
        .filter((item) => item.event.includes('recovery'))
        .map((item) => ({ event: item.event, outcome: item.outcome, createdAt: item.createdAt.toISOString() })),
    },
    message: 'Security overview retrieved.',
  });
});

securityRouter.delete(
  '/security/federated/:identityId',
  csrfProtection,
  validateRequest({ params: securityIdentityPathSchema, body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'google_unlink', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const identityId = typeof req.params.identityId === 'string' ? req.params.identityId : req.params.identityId[0];

    await removeAccessMethod(current, { kind: 'google', identityId });
    res.status(204).send();
  },
);

securityRouter.delete(
  '/security/devices/:deviceId',
  authed({ authority: 'full' }),
  validateRequest({ params: securityDevicePathSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { deviceId } = getValidated<{ params: typeof securityDevicePathSchema }>(req).params!;
    const [revoked] = await db
      .update(userDevices)
      .set({ expiresAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(
          eq(userDevices.id, deviceId),
          eq(userDevices.userId, current.id),
          gt(userDevices.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .returning();

    if (!revoked) {
      throw new HttpError({
        code: 'trusted_device_not_found',
        message: 'The trusted device was not found.',
        statusCode: 404,
      });
    }
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'trusted_device_revoked',
      outcome: 'accepted',
      userId: current.id,
      accountId: current.accountId,
      contextHash: requestContext(req),
      createdAt: DateTime.utc().toJSDate(),
    });
    res.status(204).send();
  },
);
