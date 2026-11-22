import { z } from 'zod';
import {
  VaultError,
  wrappingAad,
  wrappingContextSchema,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import { decodeBytes, encodeBytes } from '../crypto/cipher';

import { deviceCustodyContext } from './device-custody';

function bytes(value?: BufferSource): Uint8Array | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/** Local WebAuthn ceremony only: PRF output/assertions are never sent to the cloud. */
export class PrfUnlock implements VaultUnlock {
  private pending: AbortController | undefined;

  constructor(
    private readonly environment: {
      origin: string;
      rpId: string;
      credentials: CredentialsContainer | undefined;
      crypto: Crypto;
    },
  ) {}

  async secret(context: WrappingContext): Promise<Uint8Array> {
    const result = await this.assertion({ contexts: [context] });

    return result.secret;
  }

  /** Evaluate both existing wrapping salts in one user-verified assertion for this credential. */
  async forDevice(context: WrappingContext, signal: AbortSignal): Promise<VaultUnlock> {
    const result = await this.assertion({ contexts: [context], device: true, cancellation: signal });

    return this.deviceSecrets(context, result, signal);
  }

  /** The caller supplies only the authenticated account's registered WebAuthn credential IDs. */
  async forRegisteredDevice(
    context: Omit<WrappingContext, 'methodId'>,
    credentialIds: readonly string[],
    signal: AbortSignal,
  ): Promise<{ binding: WrappingContext; unlock: VaultUnlock }> {
    if (!credentialIds.length) {
      throw new VaultError('passkey-not-registered');
    }

    const result = await this.assertion({
      contexts: credentialIds.map((methodId) => ({ ...context, methodId })),
      device: true,
      registered: true,
      cancellation: signal,
    });
    const binding = { ...context, methodId: result.credentialId };

    // Require both outputs before setup persists either wrapper. A canceled second prompt leaves no binding.
    if (!result.second) {
      try {
        const device = await this.assertion({
          contexts: [deviceCustodyContext(binding)],
          registered: true,
          cancellation: signal,
        });

        result.second = device.secret;
      } catch (error) {
        result.secret.fill(0);

        throw error;
      }
    }

    return { binding, unlock: this.deviceSecrets(binding, result, signal) };
  }

  /** Select an existing PRF-capable credential without registering one in the sign-in picker. */
  async discover(signal: AbortSignal): Promise<string> {
    const result = await this.assertion({ cancellation: signal });

    result.secret.fill(0);

    return result.credentialId;
  }

  cancel(): void {
    this.pending?.abort();
    this.pending = undefined;
  }

  private deviceSecrets(
    context: WrappingContext,
    result: { secret: Uint8Array; second: Uint8Array | undefined },
    signal: AbortSignal,
  ): VaultUnlock {
    const device = deviceCustodyContext(context);
    const secrets = new Map([
      [wrappingAad(context), result.secret],
      [wrappingAad(device), result.second],
    ]);

    return {
      secret: async (binding) => {
        const id = wrappingAad(binding);
        const secret = secrets.get(id);

        if (signal.aborted || !secrets.delete(id)) {
          throw new VaultError('stale-operation');
        }

        // Authenticators that return only the first result still verify the device salt separately.
        if (!secret) {
          const assertion = await this.assertion({ contexts: [binding], cancellation: signal });

          return assertion.secret;
        }

        return secret;
      },
      cancel: () => {
        this.cancel();
        for (const secret of secrets.values()) {
          secret?.fill(0);
        }
        secrets.clear();
      },
    };
  }

  private async assertion(request: {
    contexts?: readonly WrappingContext[];
    device?: boolean;
    registered?: boolean;
    cancellation?: AbortSignal;
  }) {
    this.cancel();
    const { origin, rpId, credentials, crypto } = this.environment;
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new VaultError('origin-mismatch');
    }

    if (
      url.origin !== origin ||
      (url.protocol !== 'https:' &&
        !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) ||
      !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
    ) {
      throw new VaultError('origin-mismatch');
    }

    const configured = request.contexts?.map((context) => {
      const binding = wrappingContextSchema.safeParse(context);

      if (!binding.success || binding.data.origin !== origin) {
        throw new VaultError('origin-mismatch');
      }

      if (binding.data.method !== 'passkey-prf') {
        throw new VaultError('unsupported-prf');
      }

      return binding.data;
    });

    if (!credentials?.get || !crypto?.subtle) {
      throw new VaultError('unsupported-prf');
    }

    const controller = new AbortController();
    const signal = request.cancellation
      ? AbortSignal.any([controller.signal, request.cancellation])
      : controller.signal;

    this.pending = controller;
    let prf: Uint8Array | undefined;
    let second: Uint8Array | undefined;

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const encoder = new TextEncoder();
      const salt = (context: WrappingContext) =>
        crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(['visomi.prf', 1, wrappingAad(context)])));
      const evaluations = await Promise.all(
        (configured ?? []).map(async (context) => {
          const [first, second] = await Promise.all([
            salt(context),
            request.device ? salt(deviceCustodyContext(context)) : undefined,
          ]);

          return [context.methodId, { first, ...(second && { second }) }] as const;
        }),
      );
      const prfInput =
        evaluations.length > 1
          ? { evalByCredential: Object.fromEntries(evaluations) }
          : { eval: evaluations[0]?.[1] ?? { first: crypto.getRandomValues(new Uint8Array(32)) } };

      signal.throwIfAborted();

      const credential = await credentials.get({
        mediation: 'required',
        signal,
        publicKey: {
          challenge,
          rpId,
          userVerification: 'required',
          timeout: 60_000,
          ...(configured && {
            allowCredentials: configured.map(({ methodId }) => ({
              type: 'public-key',
              id: decodeBytes(methodId, Math.floor((methodId.length * 6) / 8)),
            })),
          }),
          extensions: { prf: prfInput },
        },
      });

      if (signal.aborted || this.pending !== controller) {
        throw new VaultError('cancelled');
      }

      if (!credential || credential.type !== 'public-key') {
        throw new VaultError('unavailable');
      }

      const assertion = credential as PublicKeyCredential;
      const response = assertion.response as AuthenticatorAssertionResponse;
      const results = assertion.getClientExtensionResults().prf?.results;

      prf = bytes(results?.first);
      second = bytes(results?.second);

      const schema = z.object({
        type: z.literal('webauthn.get'),
        challenge: z.literal(encodeBytes(challenge)),
        origin: z.literal(origin),
        crossOrigin: z.literal(false).optional(),
      });
      const clientData: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.clientDataJSON));
      const authData = new Uint8Array(response.authenticatorData);
      const expectedRpId = await crypto.subtle.digest('SHA-256', encoder.encode(rpId));

      if (
        !schema.safeParse(clientData).success ||
        !assertion.id ||
        assertion.id !== encodeBytes(new Uint8Array(assertion.rawId)) ||
        authData.length < 37 ||
        encodeBytes(authData.subarray(0, 32)) !== encodeBytes(new Uint8Array(expectedRpId)) ||
        (authData[32] & 5) !== 5
      ) {
        throw new VaultError('origin-mismatch');
      }

      if (signal.aborted || this.pending !== controller) {
        throw new VaultError('cancelled');
      }

      if (configured && !configured.some(({ methodId }) => assertion.id === methodId)) {
        throw new VaultError(request.registered ? 'passkey-not-registered' : 'origin-mismatch');
      }

      if (!prf) {
        throw new VaultError('unsupported-prf');
      }

      if (prf.byteLength !== 32 || (second && second.byteLength !== 32)) {
        throw new VaultError('unavailable');
      }

      return {
        credentialId: assertion.id,
        secret: Uint8Array.from(prf),
        second: request.device && second ? Uint8Array.from(second) : undefined,
      };
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }

      throw new VaultError(
        signal.aborted || (error instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(error.name))
          ? 'cancelled'
          : 'unavailable',
      );
    } finally {
      prf?.fill(0);
      second?.fill(0);

      if (this.pending === controller) {
        this.pending = undefined;
      }
    }
  }
}
