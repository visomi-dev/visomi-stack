import type { ProductPolicy } from '@visomi-stack/shared-persistence';
import { HttpError, routes } from '@visomi-stack/web-backend-shared';
import type { ErrorRequestHandler, Request } from 'express';
import { Router, json } from 'express';

import { Access } from '../access/service';
import type { AuthRuntime } from '../auth/runtime';
import { requireFull } from '../auth/shared/identity';
import { csrf, rateLimit } from '../auth/shared/security';

import { persistenceContracts as contracts } from './contracts';
import { SaasRecords } from './records';
import { registerVaultRoutes } from './vault-router';
import { validatePersistenceComposition } from './composition';
import { PersistenceMaintenance } from './maintenance';

export function createPersistenceRouter(auth: AuthRuntime, policy: ProductPolicy) {
  const router = Router();
  const access = new Access(auth.database, validatePersistenceComposition(policy));
  const records = new SaasRecords(access);
  const maintenance = new PersistenceMaintenance(access);
  const actor = (request: Request) => ({ sessionId: request.sessionID, principal: requireFull(request.user) });
  const target = (params: { tenantId: string; scopeId: string }) => ({
    tenantId: params.tenantId,
    scopeId: params.scopeId,
  });

  router.use((_request, response, next) => {
    response.set('cache-control', 'no-store');
    next();
  });
  router.use(
    auth.requireInitialized,
    auth.requireVerifiedSession,
    rateLimit(auth.requestLimits, auth.config),
    csrf(auth.config),
  );
  router.use(
    [
      '/tenants/:tenantId/scopes/:scopeId/domains/:domain/sync',
      '/tenants/:tenantId/scopes/:scopeId/domains/:domain/devices',
    ],
    json({ limit: '2mb' }),
  );
  router.use(json({ limit: '32kb' }));
  routes.register(router, [
    {
      contract: contracts.maintenance,
      handler: async (req, res, value) => {
        const result = await maintenance.run(actor(req), target(value.params), value.params.domain, value.body);

        return res.json(result);
      },
    },
    {
      contract: contracts.policy,
      handler: (_request, response) =>
        response.json({ policy: access.policy, origin: auth.config.origin, rpId: auth.config.rpId }),
    },
    {
      contract: contracts.createTenant,
      handler: async (req, res) => {
        const result = await access.createTenant(actor(req));

        return res.json(result);
      },
    },
    {
      contract: contracts.createScope,
      handler: async (req, res, value) => {
        const result = await access.createScope(actor(req), value.params, value.body);

        return res.json(result);
      },
    },
    {
      contract: contracts.member,
      handler: async (req, res, value) => {
        const result = await access.setMember(actor(req), value.params, value.body);

        return res.json(result);
      },
    },
    {
      contract: contracts.grant,
      handler: async (req, res, value) => {
        const result = await access.setGrant(actor(req), value.params, value.body);

        return res.json(result);
      },
    },
    {
      contract: contracts.list,
      handler: async (req, res, value) => {
        const result = await records.list(actor(req), target(value.params), value.params.domain, value.query);

        return res.json(result);
      },
    },
    {
      contract: contracts.export,
      handler: async (req, res, value) => {
        const result = await records.list(actor(req), target(value.params), value.params.domain, value.query);

        return res.json(result);
      },
    },
    {
      contract: contracts.read,
      handler: async (req, res, value) => {
        const result = await records.read(actor(req), target(value.params), value.params.domain, value.params.id);

        return res.json(result);
      },
    },
    {
      contract: contracts.mutate,
      handler: async (req, res, value) => {
        const result = await records.mutate(actor(req), target(value.params), value.params.domain, value.body);

        return res.json(result);
      },
    },
  ]);
  registerVaultRoutes(router, access);
  const errors: ErrorRequestHandler = (error, _request, _response, next) => {
    const type = (error as { type?: string })?.type;

    next(
      HttpError.is(error)
        ? error
        : type === 'entity.too.large'
          ? new HttpError(413, 'request_invalid')
          : type === 'entity.parse.failed'
            ? new HttpError(400, 'request_invalid')
            : new HttpError(503, 'persistence_unavailable'),
    );
  };

  router.use(errors);

  return router;
}
