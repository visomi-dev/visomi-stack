import { and, eq, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import type { Request } from 'express';
import { DateTime } from 'luxon';

import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import { removeAccessMethod } from './access-methods';
import { credentialView, failure, requireFreshSecurityReauthentication } from './passkey-ceremony';
import { credentialIdPathSchema, credentialMutationSchema } from './passkey-schemas';

import { accountPasskeyCredentials, db } from 'shared';

export const passkeyCredentialsRouter = Router();

passkeyCredentialsRouter.use('/credentials', authed({ authority: 'full' }));
passkeyCredentialsRouter.get('/credentials', async (req, res) => {
  const user = authedRequest(req).user;
  const values = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, user.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        eq(accountPasskeyCredentials.status, 'active'),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );

  res.json({
    data: { credentials: values.filter((value) => !value.revokedAt).map(credentialView) },
    message: 'Passkeys retrieved.',
  });
});

passkeyCredentialsRouter.patch(
  '/credentials/:credentialId',
  validateRequest({ params: credentialIdPathSchema, body: credentialMutationSchema }),
  async (req, res) => {
    const user = authedRequest(req).user;
    const credentialId = pathCredentialId(req);
    const body = getValidated<{ body: typeof credentialMutationSchema }>(req).body!;

    requireFreshSecurityReauthentication(req);
    if ('label' in body) {
      const [conflict] = await db
        .select({ id: accountPasskeyCredentials.id })
        .from(accountPasskeyCredentials)
        .where(
          and(
            eq(accountPasskeyCredentials.accountId, user.accountId),
            eq(accountPasskeyCredentials.label, body.label),
            ne(accountPasskeyCredentials.credentialId, credentialId),
            eq(accountPasskeyCredentials.status, 'active'),
            isNull(accountPasskeyCredentials.revokedAt),
          ),
        )
        .limit(1);

      if (conflict) {
        failure('credential_name_conflict', 409, 'Choose a different passkey name.');
      }
      const [value] = await db
        .update(accountPasskeyCredentials)
        .set({ label: body.label, updatedAt: DateTime.utc().toJSDate() })
        .where(
          and(
            eq(accountPasskeyCredentials.accountId, user.accountId),
            eq(accountPasskeyCredentials.userId, user.id),
            eq(accountPasskeyCredentials.credentialId, credentialId),
            eq(accountPasskeyCredentials.status, 'active'),
            isNull(accountPasskeyCredentials.revokedAt),
          ),
        )
        .returning();

      if (!value) {
        failure('credential_not_found', 404);
      }
      delete req.session?.passkeySecurityReauthenticatedAt;
      res.json({ data: credentialView(value), message: 'Passkey renamed.' });

      return;
    }
    const revoked = await revokeCredential(req, credentialId);

    if (revoked) {
      res.json({ data: credentialView(revoked), message: 'Passkey revoked.' });
    } else {
      res.status(204).send();
    }
  },
);

passkeyCredentialsRouter.delete(
  '/credentials/:credentialId',
  validateRequest({ params: credentialIdPathSchema }),
  async (req, res) => {
    requireFreshSecurityReauthentication(req);
    await revokeCredential(req, pathCredentialId(req));
    res.status(204).send();
  },
);

function pathCredentialId(req: Request): string {
  const value = req.params.credentialId;

  return typeof value === 'string' ? value : (value[0] ?? '');
}

async function revokeCredential(
  req: Request,
  credentialId: string,
): Promise<typeof accountPasskeyCredentials.$inferSelect | null> {
  const user = authedRequest(req).user;
  const removed = await removeAccessMethod(user, { kind: 'passkey', credentialId });

  delete req.session?.passkeySecurityReauthenticatedAt;

  return removed;
}
