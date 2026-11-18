import { VaultError } from '@visomi-stack/shared-db';

/** Dedicated local unlock credential. No attestation, assertion or extension output is sent to cloud authentication. */
export async function createPrfCredential(
  environment: { origin: string; rpId: string; credentials: CredentialsContainer; crypto: Crypto },
  signal: AbortSignal,
): Promise<string> {
  const url = new URL(environment.origin);

  if (
    url.origin !== environment.origin ||
    !(url.hostname === environment.rpId || url.hostname.endsWith(`.${environment.rpId}`)) ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
  ) {
    throw new VaultError('origin-mismatch');
  }

  const { credentials, crypto, rpId } = environment;

  try {
    const credential = await credentials.create({
      signal,
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: rpId, name: 'Private vault' },
        user: { id: crypto.getRandomValues(new Uint8Array(32)), name: 'Private vault', displayName: 'Private vault' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: {} },
        timeout: 60_000,
      },
    });

    if (signal.aborted) {
      throw new VaultError('cancelled');
    }

    if (!(credential instanceof PublicKeyCredential) || credential.getClientExtensionResults().prf?.enabled !== true) {
      throw new VaultError('unsupported-prf');
    }

    return credential.id;
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }

    throw new VaultError(
      signal.aborted || (error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))
        ? 'cancelled'
        : 'unsupported-prf',
    );
  }
}
