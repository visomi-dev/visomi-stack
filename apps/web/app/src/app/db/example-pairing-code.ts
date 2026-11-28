import {
  VaultError,
  scopeTuple,
  type DeviceProof,
  type PairingCodeExchange,
  type SigningPin,
} from '@visomi-stack/shared-db';
import { WebCryptoDevices, encodeBytes } from '@visomi-stack/web-frontend-db';

type Opaque = typeof import('@serenity-kit/opaque');
type Identifiers = Awaited<ReturnType<typeof pairingCodeIdentifiers>>;
type Answer = NonNullable<PairingCodeExchange['a1']>;

async function loadOpaque(): Promise<Opaque> {
  const opaque = await import('@serenity-kit/opaque');

  await opaque.ready;

  return opaque;
}

export function generatePairingCode(next: () => number): string {
  const range = 100_000_000;
  const limit = Math.floor(2 ** 32 / range) * range;
  let value = next();

  while (value >= limit) {
    value = next();
  }

  return String(value % range).padStart(8, '0');
}

export async function pairingCodeIdentifiers(crypto: Crypto, proof: DeviceProof, signer: SigningPin) {
  const format = 'visomi.vault-pairing-code';
  const { product, domain, scope, generation } = proof.key;
  const binding = [proof.ownerId, product, domain, scopeTuple(scope), generation, proof.requestId];
  const fingerprint = await new WebCryptoDevices(crypto).fingerprint(proof);
  const identifier = async (role: string, ...device: string[]) => {
    const bytes = new TextEncoder().encode(JSON.stringify([format, 1, role, ...binding, ...device]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);

    return `${format}.v1:${role}:${encodeBytes(new Uint8Array(digest))}`;
  };
  const [client, server] = await Promise.all([
    // The fingerprint binds the enrollment message. Bind the proof's signature bytes as well.
    identifier('recipient', proof.deviceId, fingerprint, proof.proof),
    identifier('approver', signer.deviceId, signer.signing),
  ]);

  return { client, server };
}

export class RecipientPairingCode {
  private constructor(
    private readonly opaque: Opaque,
    readonly r1: string,
    private state: { password: string; clientLoginState: string } | undefined,
  ) {}

  static async start(crypto: Crypto, signal: AbortSignal) {
    const opaque = await loadOpaque();

    signal.throwIfAborted();

    const sample = new Uint32Array(1);
    const password = generatePairingCode(() => crypto.getRandomValues(sample)[0]);

    sample.fill(0);

    const { startLoginRequest, clientLoginState } = opaque.client.startLogin({ password });

    return new RecipientPairingCode(opaque, startLoginRequest, { password, clientLoginState });
  }

  get code(): string {
    return this.state?.password ?? '';
  }

  finish(answer: Answer, identifiers: Identifiers): string {
    const state = this.state;

    this.clear();

    if (state) {
      const result = this.opaque.client.finishLogin({ ...state, loginResponse: answer.loginResponse, identifiers });

      if (result) {
        return result.finishLoginRequest;
      }
    }

    throw new VaultError('corrupt');
  }

  clear(): void {
    this.state = undefined;
  }
}

export class ApproverPairingCode {
  private login?: { opaque: Opaque; serverLoginState: string; identifiers: Identifiers };

  constructor(private password: string) {}

  async start(r1: string, signer: SigningPin, identifiers: Identifiers): Promise<Answer> {
    const opaque = await loadOpaque();
    const password = this.password;

    this.password = '';

    if (!password) {
      throw new VaultError('corrupt');
    }

    const serverSetup = opaque.server.createSetup();
    const userIdentifier = identifiers.client;
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password });
    const { registrationResponse } = opaque.server.createRegistrationResponse({
      serverSetup,
      userIdentifier,
      registrationRequest,
    });
    const { registrationRecord } = opaque.client.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse,
      identifiers,
    });
    const { loginResponse, serverLoginState } = opaque.server.startLogin({
      serverSetup,
      userIdentifier,
      registrationRecord,
      startLoginRequest: r1,
      identifiers,
    });

    this.login = { opaque, serverLoginState, identifiers };

    return { loginResponse, signer };
  }

  finish(finishLoginRequest: string): void {
    const login = this.login;

    this.clear();

    if (
      !login?.opaque.server.finishLogin({
        serverLoginState: login.serverLoginState,
        identifiers: login.identifiers,
        finishLoginRequest,
      })
    ) {
      throw new VaultError('corrupt');
    }
  }

  clear(): void {
    this.password = '';
    this.login = undefined;
  }
}
