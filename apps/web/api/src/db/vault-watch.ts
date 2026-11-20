import type { Database } from '@visomi-stack/backend-db';
import { deviceActionSchema, syncWatchBody, syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';

import { Access, input } from '../access/service';
import { readPrincipal, requireFull } from '../auth/shared/identity';

import { requireCurrentOperation } from './operation-time';
import { requireSyncDevice } from './sync-device';
import { VaultAccess } from './vault-access';

export type VaultWatchSession = { id: string; user: unknown; csrf?: string };

export function createVaultWatch(database: Database) {
  const access = new Access(database, syntheticHybridPolicy);
  const vault = new VaultAccess(access);
  const policy = vault.policy('private-resources');

  return async (session: VaultWatchSession, proof: unknown): Promise<string> => {
    const action = input(deviceActionSchema, proof);
    const scope = action.key.scope;

    if (scope.kind !== 'resource' || !session.csrf) {
      throw new HttpError(403, 'scope_access_denied');
    }

    const current = await readPrincipal(database, session.user);
    const principal = requireFull(current || undefined);
    const target = { tenantId: scope.tenantId, scopeId: scope.resourceId };
    const body = syncWatchBody(session.csrf);

    return access.withScope({ sessionId: session.id, principal }, target, 'read', async (context) => {
      if (!context.scope.objectBackup) {
        throw new HttpError(403, 'scope_access_denied');
      }

      const { key, registry } = await vault.registry(context, policy, true);

      if (registry.phase !== 'ready') {
        throw new HttpError(409, 'rotation_required');
      }

      requireCurrentOperation(action.operationId, policy);

      await requireSyncDevice(context, key, registry.epoch, action, action.operationId, body);

      return context.scope.id;
    });
  };
}
