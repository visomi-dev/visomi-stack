import { createHash, randomBytes } from 'node:crypto';

import { authSchema, persistenceSchema } from '@visomi-stack/backend-db';
import { HttpError, routes } from '@visomi-stack/web-backend-shared';
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { Request, Router } from 'express';

import type { Access, ScopeAccess } from '../access/service';
import type { AccessTarget } from '../access/contracts';
import type { AuthRuntime } from '../auth/runtime';
import { requireFull } from '../auth/shared/identity';

import { cloudSharingContracts as contracts } from './cloud-sharing-contracts';

const { cloudShareLinks, grants, memberships } = persistenceSchema;
const { users } = authSchema;
const linkLifetime = 7 * 24 * 60 * 60 * 1_000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const byScope = ({ tenantId, scopeId }: AccessTarget) =>
  and(eq(cloudShareLinks.tenantId, tenantId), eq(cloudShareLinks.scopeId, scopeId));

function requireOwner(context: ScopeAccess): void {
  if (!context.membership.owner || context.scope.kind !== 'resource') {
    throw new HttpError(403, 'scope_access_denied');
  }
}

export function registerCloudSharing(router: Router, access: Access, auth: AuthRuntime) {
  const actor = (request: Request) => ({ sessionId: request.sessionID, principal: requireFull(request.user) });
  const hint = (userId: string) => void auth.realtimePublisher?.notifyCloud?.(userId).catch(() => undefined);

  routes.register(router, [
    {
      contract: contracts.list,
      handler: async (request, response, { params }) => {
        const sharing = await access.withScope(actor(request), params, 'share', async (context) => {
          requireOwner(context);
          const { tx, target } = context;
          const [link] = await tx
            .select({ expiresAt: cloudShareLinks.expiresAt })
            .from(cloudShareLinks)
            .where(and(byScope(target), gt(cloudShareLinks.expiresAt, new Date())));
          const readers = await tx
            .select({ id: users.id, email: users.email })
            .from(grants)
            .innerJoin(
              memberships,
              and(eq(grants.userId, memberships.userId), eq(grants.tenantId, memberships.tenantId)),
            )
            .innerJoin(users, eq(grants.userId, users.id))
            .where(
              and(
                eq(grants.tenantId, target.tenantId),
                eq(grants.scopeId, target.scopeId),
                eq(grants.role, 'viewer'),
                isNull(memberships.revokedAt),
                isNotNull(users.emailVerifiedAt),
              ),
            )
            .orderBy(users.email);

          return { linkExpiresAt: link?.expiresAt.toISOString() ?? null, readers };
        });

        return response.json(sharing);
      },
    },
    {
      contract: contracts.createLink,
      handler: async (request, response, { params }) => {
        const link = await access.withScope(actor(request), params, 'share', async (context) => {
          requireOwner(context);
          const token = randomBytes(32).toString('base64url');
          const tokenHash = digest(token);
          const expiresAt = new Date(Date.now() + linkLifetime);

          await context.tx
            .insert(cloudShareLinks)
            .values({ ...context.target, tokenHash, expiresAt })
            .onConflictDoUpdate({ target: cloudShareLinks.scopeId, set: { tokenHash, expiresAt } });

          return { token, expiresAt: expiresAt.toISOString() };
        });

        return response.json(link);
      },
    },
    {
      contract: contracts.disableLink,
      handler: async (request, response, { params }) => {
        await access.withScope(actor(request), params, 'share', async (context) => {
          requireOwner(context);

          await context.tx.delete(cloudShareLinks).where(byScope(context.target));
        });

        return response.json({ changed: true });
      },
    },
    {
      contract: contracts.redeem,
      handler: async (request, response, { body }) => {
        const current = actor(request);
        const userId = current.principal.id;
        const tokenHash = digest(body.token);
        const [link] = await auth.database
          .select({ tenantId: cloudShareLinks.tenantId })
          .from(cloudShareLinks)
          .where(eq(cloudShareLinks.tokenHash, tokenHash));

        if (!link) {
          throw new HttpError(403, 'cloud_share_unavailable');
        }

        const scope = await access.withTenant(current, link.tenantId, async (tx, tenant) => {
          const [target] = await tx
            .select({ tenantId: cloudShareLinks.tenantId, scopeId: cloudShareLinks.scopeId })
            .from(cloudShareLinks)
            .where(
              and(
                eq(cloudShareLinks.tenantId, tenant.id),
                eq(cloudShareLinks.tokenHash, tokenHash),
                gt(cloudShareLinks.expiresAt, new Date()),
              ),
            );

          if (!target) {
            throw new HttpError(403, 'cloud_share_unavailable');
          }

          const [membership] = await tx
            .select()
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, userId)));
          const [grant] = await tx
            .select()
            .from(grants)
            .where(and(eq(grants.tenantId, tenant.id), eq(grants.scopeId, target.scopeId), eq(grants.userId, userId)));

          if (membership?.revokedAt || grant?.role === 'blocked') {
            throw new HttpError(403, 'cloud_share_unavailable');
          }

          if (!membership?.owner && !grant) {
            await tx.insert(memberships).values({ tenantId: tenant.id, userId }).onConflictDoNothing();

            await tx.insert(grants).values({ ...target, userId, role: 'viewer' });
          }

          return target;
        });

        hint(userId);

        return response.json(scope);
      },
    },
    {
      contract: contracts.email,
      handler: async (request, response, { params, body }) => {
        const { mail } = auth;

        const notification = await access.withScope(actor(request), params, 'share', async (context) => {
          requireOwner(context);

          if (!mail) {
            throw new HttpError(503, 'cloud_mail_unavailable');
          }

          const { tx, target } = context;
          const [recipient] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.email, body.email), isNotNull(users.emailVerifiedAt)));

          if (!recipient || recipient.id === context.actor.principal.id) {
            throw new HttpError(400, 'cloud_recipient_unavailable');
          }

          await tx
            .insert(memberships)
            .values({ tenantId: target.tenantId, userId: recipient.id })
            .onConflictDoUpdate({
              target: [memberships.tenantId, memberships.userId],
              set: { revokedAt: null },
            });

          await tx
            .insert(grants)
            .values({ ...target, userId: recipient.id, role: 'viewer' })
            .onConflictDoUpdate({
              target: [grants.tenantId, grants.scopeId, grants.userId],
              set: { role: 'viewer' },
            });

          return { userId: recipient.id, mail };
        });

        hint(notification.userId);
        const url = new URL(
          `/app/${body.locale}/db-example/cloud/${params.tenantId}/${params.scopeId}`,
          auth.config.origin,
        );
        const subject =
          body.locale === 'es' ? 'Te compartieron un espacio en Stack' : 'A Stack workspace was shared with you';
        const action =
          body.locale === 'es'
            ? 'Abre el espacio con tu cuenta de Stack.'
            : 'Open the workspace with your Stack account.';

        try {
          await notification.mail.send({
            to: body.email,
            subject,
            text: `${action}\n${url.href}`,
            html: `<p>${action}</p><p><a href="${url.href}">${url.href}</a></p>`,
          });

          return response.json({ sent: true });
        } catch {
          return response.json({ sent: false });
        }
      },
    },
    {
      contract: contracts.revoke,
      handler: async (request, response, { params: { userId, ...target } }) => {
        const revoked = await access.withScope(actor(request), target, 'share', async (context) => {
          requireOwner(context);

          return context.tx
            .update(grants)
            .set({ role: 'blocked' })
            .where(
              and(
                eq(grants.tenantId, target.tenantId),
                eq(grants.scopeId, target.scopeId),
                eq(grants.userId, userId),
                eq(grants.role, 'viewer'),
              ),
            )
            .returning({ id: grants.userId });
        });

        if (revoked.length) {
          hint(userId);
        }

        return response.json({ changed: true });
      },
    },
  ]);
}
