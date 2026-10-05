import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import { operationGrantSchema, totpConfirmSchema } from './auth-schemas';
import { findUserById } from './auth-identity';
import { replaceRecoveryCodes } from './auth-factors';
import { refreshSessionAuthVersion } from './auth-session';
import { csrfProtection } from './passkey-security';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpCode } from './totp';

import {
  accountPasskeyCredentials,
  db,
  HttpError,
  httpResponse,
  userFederatedIdentities,
  users,
  userTotpEnrollments,
} from 'shared';

export const totpRouter = Router();

totpRouter.post(
  '/totp/setup',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'totp_change', grantSource: 'body' } }),
  async function totpSetupHandler(req, res) {
    if (!env.AUTH_TOTP_ENROLLMENT_ENABLED) {
      throw new HttpError({
        code: 'totp_enrollment_disabled',
        message: 'TOTP enrollment is disabled.',
        statusCode: 404,
      });
    }
    const current = authedRequest(req).user;
    const secret = generateTotpSecret();
    const now = DateTime.utc();
    const enrollmentId = randomUUID();

    await db
      .update(userTotpEnrollments)
      .set({ status: 'revoked', updatedAt: now.toJSDate() })
      .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'pending')));
    await db.insert(userTotpEnrollments).values({
      id: enrollmentId,
      userId: current.id,
      encryptedSecret: encryptTotpSecret(secret),
      expiresAt: now.plus({ minutes: 10 }).toJSDate(),
      createdAt: now.toJSDate(),
      updatedAt: now.toJSDate(),
    });
    res.setHeader('Cache-Control', 'no-store');
    httpResponse.json(res, { data: { enrollmentId, secret }, status: 201, message: 'TOTP enrollment started.' });
  },
);

totpRouter.post(
  '/totp/confirm',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: totpConfirmSchema }),
  async function totpConfirmHandler(req, res) {
    const current = authedRequest(req).user;
    const { enrollmentId, code } = getValidated<{ body: typeof totpConfirmSchema }>(req).body!;
    const [enrollment] = await db
      .select()
      .from(userTotpEnrollments)
      .where(
        and(
          eq(userTotpEnrollments.id, enrollmentId),
          eq(userTotpEnrollments.userId, current.id),
          eq(userTotpEnrollments.status, 'pending'),
        ),
      )
      .limit(1);

    if (!enrollment || enrollment.expiresAt <= DateTime.utc().toJSDate()) {
      throw new HttpError({
        code: 'totp_enrollment_unavailable',
        message: 'The TOTP enrollment is unavailable.',
        statusCode: 410,
      });
    }
    let valid: boolean;

    try {
      const verified = await verifyTotpCode(decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion), code);

      valid = verified;
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new HttpError({ code: 'totp_code_invalid', message: 'The TOTP code is invalid.', statusCode: 401 });
    }
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, current.id)).for('update');
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'active', confirmedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
        .where(and(eq(userTotpEnrollments.id, enrollment.id), eq(userTotpEnrollments.status, 'pending')));
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'revoked', updatedAt: DateTime.utc().toJSDate() })
        .where(
          and(
            eq(userTotpEnrollments.userId, current.id),
            eq(userTotpEnrollments.status, 'active'),
            ne(userTotpEnrollments.id, enrollment.id),
          ),
        );
      await tx
        .update(users)
        .set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: DateTime.utc().toJSDate() })
        .where(eq(users.id, current.id));
    });
    refreshSessionAuthVersion(req, (current.authVersion ?? 1) + 1);
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    delete req.session.passkeySecurityReauthenticatedAt;
    httpResponse.json(res, { data: { enabled: true, recoveryCodes }, message: 'TOTP enrollment confirmed.' });
  },
);

totpRouter.post(
  '/totp/disable',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'totp_disable', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const [passkey] = await db
      .select({ id: accountPasskeyCredentials.id })
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, current.id),
          eq(accountPasskeyCredentials.accountId, current.accountId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      )
      .limit(1);
    const [federated] = await db
      .select({ id: userFederatedIdentities.id })
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.userId, current.id), isNull(userFederatedIdentities.revokedAt)))
      .limit(1);
    const user = await findUserById(current.id);

    if (!passkey && !federated && !user?.passwordHash) {
      throw new HttpError({
        code: 'last_access_method',
        message: 'Keep another sign-in method before disabling TOTP.',
        statusCode: 409,
      });
    }
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, current.id)).for('update');
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'revoked', updatedAt: DateTime.utc().toJSDate() })
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')));
      await tx
        .update(users)
        .set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: DateTime.utc().toJSDate() })
        .where(eq(users.id, current.id));
    });
    res.status(204).send();
  },
);

totpRouter.post(
  '/recovery-codes/regenerate',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'recovery_codes_regenerate', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    httpResponse.json(res, { data: { recoveryCodes }, message: 'Recovery codes regenerated.' });
  },
);
