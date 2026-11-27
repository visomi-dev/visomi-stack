import {
  type VaultUnlock,
  type KeyDomain,
  deviceProofSchema,
  deviceProofMessage,
  keyDomainId,
  VaultError,
  wrappingContextSchema,
  type WrappingContext,
  type DeviceProof,
} from '@visomi-stack/shared-db';
import {
  WebCryptoDevices,
  createPinMethodId,
  createPrfCredential,
  deviceCustodyContext,
} from '@visomi-stack/web-frontend-db';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { z } from 'zod';

import type { VaultSession } from '../shared/vault/vault-session';
import { AuthHttp } from '../auth/shared/http';
import type { DatabaseHttp } from '../shared/db/http';

import { registeredVaultMethod } from './example-vault-enrollment';
import { examplePrivatePath, type rosterSchema, type ExampleTarget } from './example-contracts';

export class ExamplePairingDraft {
  readonly dedicated = signal(false);

  constructor(
    private readonly target: ExampleTarget,
    private readonly view: Window,
    private readonly router: Router,
    private readonly location: Location,
    private readonly api: DatabaseHttp,
  ) {}

  draftKey(owner: string) {
    return 'visomi.vault-pairing.v1:' + owner + ':' + this.target.tenantId + ':' + this.target.scopeId;
  }

  readDraft(ownerId: string, key: WrappingContext['key']) {
    const raw = this.view.localStorage.getItem(this.draftKey(ownerId));

    if (!raw) {
      return;
    }

    let value: unknown;

    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const draft = z
      .strictObject({
        context: wrappingContextSchema,
        proof: deviceProofSchema.optional(),
        dedicated: z.literal(true).optional(),
        published: z.boolean().optional(),
        recovering: z.boolean().optional(),
      })
      .safeParse(value);

    if (!draft.success) {
      return;
    }

    const { context, proof } = draft.data;

    if (
      context.ownerId !== ownerId ||
      context.origin !== this.view.location.origin ||
      keyDomainId(ownerId, context.key) !== keyDomainId(ownerId, key) ||
      (proof &&
        (proof.deviceId !== context.deviceId ||
          proof.ownerId !== ownerId ||
          keyDomainId(ownerId, proof.key) !== keyDomainId(ownerId, key)))
    ) {
      return;
    }

    return draft.data;
  }

  save(
    context: WrappingContext,
    state: { proof?: DeviceProof; published?: boolean; recovering?: boolean; dedicated?: boolean } = {},
  ) {
    const previous = this.readDraft(context.ownerId, context.key);
    const dedicated = state.dedicated || (previous?.context.deviceId === context.deviceId && previous.dedicated);

    this.dedicated.set(Boolean(dedicated));

    this.view.localStorage.setItem(
      this.draftKey(context.ownerId),
      JSON.stringify({ ...state, context, dedicated: dedicated || undefined }),
    );
  }

  retired(error: unknown) {
    return (
      error instanceof HttpErrorResponse && error.status === 404 && error.error?.error === 'device_challenge_invalid'
    );
  }

  async resume(ownerId: string, registry: ReturnType<typeof rosterSchema.parse>, signal: AbortSignal) {
    const draft = this.readDraft(ownerId, registry.key);

    this.dedicated.set(draft?.dedicated === true);

    if (draft?.proof && !draft.recovering) {
      if (
        !draft.published &&
        Date.parse(draft.proof.expiresAt) > Date.now() &&
        !registry.devices.some((device) => device.id === draft.context.deviceId)
      ) {
        try {
          await this.publish(draft.context, draft.proof, signal);
        } catch (error) {
          if (!this.retired(error)) {
            throw error;
          }
        }
      }

      const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(draft.proof);

      signal.throwIfAborted();

      return {
        context: draft.context,
        proof: draft.proof,
        fingerprint,
        token: JSON.stringify(draft.proof),
        reviewLink: this.reviewLink(draft.proof),
      };
    }

    return null;
  }

  async available(proof: DeviceProof, signal: AbortSignal) {
    if (Date.parse(proof.expiresAt) <= Date.now()) {
      return false;
    }

    try {
      await this.api.vault(examplePrivatePath(this.target) + '/devices/pairing/' + proof.requestId, undefined, signal);

      return true;
    } catch (error) {
      if (this.retired(error)) {
        return false;
      }

      throw error;
    }
  }

  reviewLink(proof: DeviceProof) {
    const link = this.router.createUrlTree(['/security'], {
      queryParams: { sample: 'vault-backup', ...this.target, requestId: proof.requestId },
    });

    return new URL(this.location.prepareExternalUrl(this.router.serializeUrl(link)), this.view.location.origin).href;
  }

  async publish(context: WrappingContext, proof: DeviceProof, signal: AbortSignal) {
    const published = await this.api
      .vault(examplePrivatePath(this.target) + '/devices/pairing', proof, signal)
      .catch((error: unknown) => {
        if (this.retired(error)) {
          this.save(context);
        }

        throw error;
      });
    const confirmed = deviceProofSchema.parse(published);

    if (deviceProofMessage(confirmed) !== deviceProofMessage(proof) || confirmed.proof !== proof.proof) {
      throw new VaultError('corrupt');
    }

    this.save(context, { proof, published: true });
  }
}

export async function openPairingDevice(options: {
  auth: AuthHttp;
  view: Window;
  rpId: string;
  vault: VaultSession;
  drafts: ExamplePairingDraft;
  backed: boolean;
  ownerId: string;
  key: KeyDomain;
  draft: ReturnType<ExamplePairingDraft['readDraft']>;
  usePin: boolean;
  createNew: boolean;
  supplied?: Uint8Array;
  signal: AbortSignal;
}) {
  const { auth, view, rpId, vault, drafts, backed, ownerId, key, draft, usePin, createNew, supplied, signal } = options;
  const base = {
    key,
    ownerId,
    deviceId: view.crypto.randomUUID(),
    method: usePin ? ('pin-argon2id' as const) : ('passkey-prf' as const),
    origin: view.location.origin,
  };
  let context: WrappingContext;
  let unlock: VaultUnlock | undefined;

  if (draft?.context.method === base.method && (!createNew || draft.dedicated)) {
    context = draft.context;
  } else if (usePin) {
    context = { ...base, methodId: createPinMethodId(view.crypto) };
  } else if (backed && !createNew) {
    const selected = await registeredVaultMethod(view, rpId, base, auth, signal);

    context = selected.binding;
    unlock = selected.unlock;
  } else {
    const methodId = await createPrfCredential(
      {
        origin: base.origin,
        rpId,
        credentials: view.navigator.credentials,
        crypto: view.crypto,
      },
      signal,
    );

    context = { ...base, methodId };
  }

  try {
    signal.throwIfAborted();

    if (backed && context.deviceId !== draft?.context.deviceId) {
      drafts.save(context, { dedicated: createNew });
    }

    const previous = await vault.localBinding(deviceCustodyContext(context).key);

    const custody = await vault.device(context, rpId, previous ? 'resume' : true, supplied, unlock);

    return { context, custody };
  } finally {
    unlock?.cancel();
  }
}
