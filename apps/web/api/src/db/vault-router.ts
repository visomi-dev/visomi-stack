import type { BackupObjects } from '@visomi-stack/backend-db';
import type { RealtimePublisher } from '@visomi-stack/backend-shared';
import { routes } from '@visomi-stack/web-backend-shared';
import type { Router, Request } from 'express';

import type { Access } from '../access/service';
import { requireFull } from '../auth/shared/identity';

import { KeyDevices } from './devices';
import { OpaqueSync } from './opaque';
import { vaultContracts as contracts } from './vault-contracts';

export function registerVaultRoutes(
  router: Router,
  access: Access,
  objects?: BackupObjects,
  realtime?: RealtimePublisher,
) {
  const devices = new KeyDevices(access);
  const sync = new OpaqueSync(access, objects, realtime?.notifyVault);
  const actor = (req: Request) => ({ sessionId: req.sessionID, principal: requireFull(req.user) });
  const target = ({ tenantId, scopeId }: { tenantId: string; scopeId: string }) => ({ tenantId, scopeId });
  const notifyPairing = (ownerId: string) => void realtime?.notifyVaultPairing?.(ownerId).catch(() => undefined);

  routes.register(router, [
    {
      contract: contracts.pairings,
      handler: async (req, res) => {
        const result = await access.listExampleVaultPairings(actor(req));

        return res.json(result);
      },
    },
    {
      contract: contracts.publishPairing,
      handler: async (req, res, value) => {
        const result = await devices.publishPairing(actor(req), value.params, value.body);

        notifyPairing(result.ownerId);

        return res.json(result);
      },
    },
    {
      contract: contracts.readPairing,
      handler: async (req, res, value) => {
        const proof = await devices.readPairing(actor(req), target(value.params), value.params.id);

        return res.json(proof);
      },
    },
    {
      contract: contracts.cancelPairing,
      handler: async (req, res, value) => {
        const session = actor(req);
        const result = await devices.cancelPairing(session, target(value.params), value.params.id);

        notifyPairing(session.principal.id);

        return res.json(result);
      },
    },
    {
      contract: contracts.readPairingCode,
      handler: async (req, res, value) => {
        const exchange = await devices.readPairingCode(actor(req), target(value.params), value.params.id);

        return res.json(exchange);
      },
    },
    {
      contract: contracts.writePairingCode,
      handler: async (req, res, value) => {
        const session = actor(req);
        const result = await devices.writePairingCode(session, target(value.params), value.params.id, value.body);

        notifyPairing(session.principal.id);

        return res.json(result);
      },
    },
    {
      contract: contracts.request,
      handler: async (req, res, value) => {
        const result = await devices.request(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.bootstrap,
      handler: async (req, res, value) => {
        const result = await devices.bootstrap(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.approve,
      handler: async (req, res, value) => {
        const result = await devices.approve(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        notifyPairing(value.body.proof.ownerId);

        return res.json(result);
      },
    },
    {
      contract: contracts.roster,
      handler: async (req, res, value) => {
        const result = await devices.roster(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.delivery,
      handler: async (req, res, value) => {
        const result = await devices.deliveryFor(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.params.id,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.revoke,
      handler: async (req, res, value) => {
        const result = await devices.revoke(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.rotate,
      handler: async (req, res, value) => {
        const result = await devices.rotate(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.pull,
      handler: async (req, res, value) => {
        const result = await sync.read(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
          req.session.csrf,
        );

        return res.json(result);
      },
    },
    {
      contract: contracts.push,
      handler: async (req, res, value) => {
        const result = await sync.write(
          actor(req),
          { tenantId: value.params.tenantId, scopeId: value.params.scopeId },
          value.params.domain,
          value.body,
        );

        return res.json(result);
      },
    },
  ]);
}
