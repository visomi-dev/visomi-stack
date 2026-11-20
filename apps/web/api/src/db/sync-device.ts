import { vaultSchema } from '@visomi-stack/backend-db';
import { deviceActionMessage, operationIdSchema, type DeviceAction, type KeyDomain } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNull } from 'drizzle-orm';

import { input, type ScopeAccess } from '../access/service';

import { verifyDeviceAction } from './device-proof';
import { scopeId } from './vault-access';

const { keyDevices } = vaultSchema;

export async function requireSyncDevice(
  context: ScopeAccess,
  key: KeyDomain,
  epoch: number,
  authorization: DeviceAction,
  operationId: string,
  body: unknown,
): Promise<void> {
  if (
    authorization.action !== 'sync' ||
    authorization.epoch !== epoch ||
    authorization.operationId !== operationId ||
    deviceActionMessage({ ...authorization, key }) !== deviceActionMessage(authorization)
  ) {
    throw new HttpError(409, 'device_state_conflict');
  }

  input(operationIdSchema, operationId);
  const [device] = await context.tx
    .select({ signing: keyDevices.signing })
    .from(keyDevices)
    .where(
      and(
        eq(keyDevices.tenantId, key.scope.tenantId),
        eq(keyDevices.scopeId, scopeId(key.scope)),
        eq(keyDevices.domain, key.domain),
        eq(keyDevices.id, authorization.deviceId),
        eq(keyDevices.ownerId, context.actor.principal.id),
        isNull(keyDevices.revokedAt),
      ),
    );

  if (!device) {
    throw new HttpError(403, 'device_approval_required');
  }

  verifyDeviceAction(device.signing, authorization, body);
}
