import { createOperationId, syncReadBody, VaultError, type WrappingContext } from '@visomi-stack/shared-db';
import {
  encodeBytes,
  replicaId,
  SyncReplica,
  type DeviceCustody,
  type ReplicaStorage,
  type ReplicaTransport,
} from '@visomi-stack/web-frontend-db';

import type { Session } from '../auth/session/session';
import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

import { rosterSchema, validateExampleEnvelope } from './example-contracts';

type TransportOptions = {
  api: DatabaseHttp;
  session: Session;
  path: string;
  crypto: Crypto;
  custody: DeviceCustody;
  binding: WrappingContext;
  checkDevice: boolean;
};

export function exampleReplica(
  options: TransportOptions & {
    vault: VaultSession;
    storage: ReplicaStorage;
    minimumEpoch: number;
    current: () => void;
  },
): SyncReplica {
  const { binding, vault, storage, minimumEpoch, crypto, current } = options;
  const { key, ownerId } = binding;

  return new SyncReplica(
    replicaId(ownerId, key, key.scope),
    key,
    key.scope,
    storage,
    exampleTransport(options),
    crypto,
    (envelope) => {
      current();
      validateExampleEnvelope(binding, envelope);

      return vault.readEnvelope(envelope, false);
    },
    minimumEpoch,
  );
}

function exampleTransport(options: TransportOptions): ReplicaTransport {
  const { api, session, path, crypto, custody, binding, checkDevice } = options;

  return {
    async pull(head, signal) {
      const body = { protocol: 1 as const, head, limit: 25 };

      if (!checkDevice) {
        return api.vault(`${path}/sync/pull`, { protocol: body.protocol, head }, signal);
      }

      const document = await api.vault(`${path}/devices`, undefined, signal);
      const registry = rosterSchema.parse(document);

      if (!registry.objectBackup) {
        return api.vault(`${path}/sync/pull`, body, signal);
      }

      if (!custody.ready || registry.key.generation !== binding.key.generation) {
        throw new VaultError('recovery-required');
      }

      const csrf = await session.token();
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(syncReadBody(body, csrf))),
      );

      signal.throwIfAborted();

      const authorization = await custody.sign({
        key: binding.key,
        deviceId: binding.deviceId,
        epoch: registry.epoch,
        operationId: createOperationId(crypto),
        action: 'sync',
        bodyHash: encodeBytes(new Uint8Array(digest)),
      });

      return api.vault(`${path}/sync/pull`, { ...body, authorization }, signal);
    },
    push: (value, signal) => api.vault(`${path}/sync/push`, value, signal),
  };
}
