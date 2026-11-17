import { z } from 'zod';
import {
  VaultError,
  wrappingAad,
  wrappingContextSchema,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-persistence';

import { decodeBytes, encodeBytes } from './crypto';

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
    this.cancel();
    const binding = wrappingContextSchema.safeParse(context);
    const { origin, rpId, credentials, crypto } = this.environment;
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new VaultError('origin-mismatch');
    }

    if (
      !binding.success ||
      binding.data.origin !== origin ||
      url.origin !== origin ||
      (url.protocol !== 'https:' &&
        !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) ||
      !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
    ) {
      throw new VaultError('origin-mismatch');
    }

    if (binding.data.method !== 'passkey-prf' || !credentials?.get || !crypto?.subtle) {
      throw new VaultError('unsupported-prf');
    }

    const controller = new AbortController();

    this.pending = controller;
    let prf: Uint8Array | undefined;

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const encoder = new TextEncoder();
      const input = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(JSON.stringify(['visomi.prf', 1, wrappingAad(binding.data)])),
      );
      const credential = await credentials.get({
        mediation: 'required',
        signal: controller.signal,
        publicKey: {
          challenge,
          rpId,
          userVerification: 'required',
          timeout: 60_000,
          allowCredentials: [
            {
              type: 'public-key',
              id: decodeBytes(binding.data.methodId, Math.floor((binding.data.methodId.length * 6) / 8)),
            },
          ],
          extensions: { prf: { eval: { first: input } } },
        },
      });

      if (controller.signal.aborted || this.pending !== controller) {
        throw new VaultError('cancelled');
      }

      if (!credential || credential.type !== 'public-key') {
        throw new VaultError('unsupported-prf');
      }

      const assertion = credential as PublicKeyCredential;
      const response = assertion.response as AuthenticatorAssertionResponse;
      const first = assertion.getClientExtensionResults().prf?.results?.first;

      if (!first || first.byteLength !== 32) {
        throw new VaultError('unsupported-prf');
      }

      prf =
        first instanceof ArrayBuffer
          ? new Uint8Array(first)
          : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
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
        assertion.id !== binding.data.methodId ||
        encodeBytes(new Uint8Array(assertion.rawId)) !== binding.data.methodId ||
        authData.length < 37 ||
        encodeBytes(authData.subarray(0, 32)) !== encodeBytes(new Uint8Array(expectedRpId)) ||
        (authData[32] & 5) !== 5
      ) {
        throw new VaultError('origin-mismatch');
      }

      if (controller.signal.aborted || this.pending !== controller) {
        throw new VaultError('cancelled');
      }

      return Uint8Array.from(prf);
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }

      throw new VaultError(
        error instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(error.name)
          ? 'cancelled'
          : 'unsupported-prf',
      );
    } finally {
      prf?.fill(0);

      if (this.pending === controller) {
        this.pending = undefined;
      }
    }
  }

  cancel(): void {
    this.pending?.abort();
    this.pending = undefined;
  }
}
