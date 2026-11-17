import {
  operationClockSkewMs,
  operationTimestamp,
  operationWindowMs,
  type DomainPolicy,
} from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';

export function requireCurrentOperation(id: string, policy: DomainPolicy) {
  const time = operationTimestamp(id);
  const now = Date.now();

  if (time > now + operationClockSkewMs || time <= now - operationWindowMs(policy)) {
    throw new HttpError(409, 'operation_expired');
  }
}
