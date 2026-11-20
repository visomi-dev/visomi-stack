import { HttpErrorResponse } from '@angular/common/http';
import {
  createOperationId,
  syncReadBody,
  syncWatchBody,
  VaultError,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import {
  encodeBytes,
  replicaId,
  SyncReplica,
  type DeviceCustody,
  type ReplicaStorage,
  type ReplicaTransport,
} from '@visomi-stack/web-frontend-db';
import { firstValueFrom, fromEvent, takeUntil, timer } from 'rxjs';

import type { Session } from '../auth/session/session';
import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

import { examplePrivatePath, rosterSchema, validateExampleEnvelope, type ExampleTarget } from './example-contracts';

type TransportOptions = {
  api: DatabaseHttp;
  session: Session;
  path: string;
  crypto: Crypto;
  custody: DeviceCustody;
  binding: WrappingContext;
  checkDevice: boolean;
};

export async function watchBackup(
  api: DatabaseHttp,
  session: Session,
  target: ExampleTarget,
  { binding, custody, view, signal }: Pick<SyncSigner, 'binding' | 'custody'> & { view: Window; signal: AbortSignal },
) {
  const document = await api.vault(`${examplePrivatePath(target)}/devices`, undefined, signal);
  const registry = rosterSchema.parse(document);

  if (registry.objectBackup && registry.phase === 'ready') {
    return signedSyncAction({ session, binding, custody, crypto: view.crypto }, registry, syncWatchBody, signal);
  }

  return undefined;
}

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
  const { api, path, checkDevice } = options;

  return {
    async pull(head, signal) {
      const body = { protocol: 1 as const, head, limit: 100 };

      if (!checkDevice) {
        return api.vault(`${path}/sync/pull`, { protocol: body.protocol, head }, signal);
      }

      const document = await retryRestore(() => api.vault(`${path}/devices`, undefined, signal), signal);
      const registry = rosterSchema.parse(document);

      if (!registry.objectBackup) {
        return retryRestore(() => api.vault(`${path}/sync/pull`, body, signal), signal);
      }

      const authorization = await signedSyncAction(options, registry, (csrf) => syncReadBody(body, csrf), signal);

      return retryRestore(() => api.vault(`${path}/sync/pull`, { ...body, authorization }, signal), signal);
    },
    push: (value, signal) => api.vault(`${path}/sync/push`, value, signal),
  };
}

type SyncSigner = Pick<TransportOptions, 'session' | 'crypto' | 'custody' | 'binding'>;

async function signedSyncAction(
  { session, crypto, custody, binding }: SyncSigner,
  registry: { key: WrappingContext['key']; epoch: number },
  body: (csrf: string) => unknown,
  signal: AbortSignal,
) {
  if (!custody.ready || registry.key.generation !== binding.key.generation) {
    throw new VaultError('recovery-required');
  }

  const csrf = await session.token();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body(csrf))));

  signal.throwIfAborted();

  const proof = await custody.sign({
    key: binding.key,
    deviceId: binding.deviceId,
    epoch: registry.epoch,
    operationId: createOperationId(crypto),
    action: 'sync',
    bodyHash: encodeBytes(new Uint8Array(digest)),
  });

  signal.throwIfAborted();

  return proof;
}

async function retryRestore(request: () => Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  // Stay inside this pull so the replica can retain verified pages until its atomic commit.
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();

    try {
      const value = await request();

      return value;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 429 || attempt === 2) {
        throw error;
      }

      signal.throwIfAborted();
      const seconds = Number(error.headers.get('Retry-After'));
      const wait = seconds > 0 && seconds <= 60 ? Math.ceil(seconds) : 60;

      await firstValueFrom(timer(wait * 1000).pipe(takeUntil(fromEvent(signal, 'abort'))), {
        defaultValue: undefined,
      });
    }
  }
}
