import { z } from 'zod';
import {
  VaultError,
  wrappingAad,
  wrappingContextSchema,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import { decodeBytes, encodeBytes } from '../crypto/cipher';

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
    const result = await this.assertion({ context });

    return result.secret;
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

  private async assertion(request: { context: WrappingContext } | { cancellation: AbortSignal }) {
    this.cancel();
    const binding = 'context' in request ? wrappingContextSchema.safeParse(request.context) : undefined;
    const { origin, rpId, credentials, crypto } = this.environment;
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new VaultError('origin-mismatch');
    }

    if (
      (binding && (!binding.success || binding.data.origin !== origin)) ||
      url.origin !== origin ||
      (url.protocol !== 'https:' &&
        !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) ||
      !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
    ) {
      throw new VaultError('origin-mismatch');
    }

    const configured = binding?.data;

    if ((configured && configured.method !== 'passkey-prf') || !credentials?.get || !crypto?.subtle) {
      throw new VaultError('unsupported-prf');
    }

    const controller = new AbortController();
    const signal =
      'cancellation' in request ? AbortSignal.any([controller.signal, request.cancellation]) : controller.signal;

    this.pending = controller;
    let prf: Uint8Array | undefined;

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const encoder = new TextEncoder();
      let input: BufferSource;

      // Discovery probes with a disposable input. Only the binding-specific output can wrap a vault key.
      if (configured) {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(JSON.stringify(['visomi.prf', 1, wrappingAad(configured)])),
        );

        input = digest;
      } else {
        input = crypto.getRandomValues(new Uint8Array(32));
      }

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
            allowCredentials: [
              {
                type: 'public-key',
                id: decodeBytes(configured.methodId, Math.floor((configured.methodId.length * 6) / 8)),
              },
            ],
          }),
          extensions: { prf: { eval: { first: input } } },
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
      const first = assertion.getClientExtensionResults().prf?.results?.first;

      if (first) {
        prf =
          first instanceof ArrayBuffer
            ? new Uint8Array(first)
            : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
      }

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
        (configured && assertion.id !== configured.methodId) ||
        authData.length < 37 ||
        encodeBytes(authData.subarray(0, 32)) !== encodeBytes(new Uint8Array(expectedRpId)) ||
        (authData[32] & 5) !== 5
      ) {
        throw new VaultError('origin-mismatch');
      }

      if (signal.aborted || this.pending !== controller) {
        throw new VaultError('cancelled');
      }

      if (!prf) {
        throw new VaultError('unsupported-prf');
      }

      if (prf.byteLength !== 32) {
        throw new VaultError('unavailable');
      }

      return { credentialId: assertion.id, secret: Uint8Array.from(prf) };
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

      if (this.pending === controller) {
        this.pending = undefined;
      }
    }
  }
}
