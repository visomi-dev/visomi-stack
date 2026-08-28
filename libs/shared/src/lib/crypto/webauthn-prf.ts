/* eslint-disable padding-line-between-statements */

import type { BrowserVaultAuthenticator } from './browser-encrypted-vault';

const encoder = new TextEncoder();

function bufferSource(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

export type WebAuthnCapability = 'prf-supported' | 'webauthn-supported' | 'unavailable';
export type WebAuthnUnlockState =
  | 'locked'
  | 'ready'
  | 'prf-unavailable'
  | 'fallback-ready'
  | 'cancelled'
  | 'lockout'
  | 'wrong-credential'
  | 'recovery-required'
  | 'revoked'
  | 'platform-error'
  | 'unsafe-fallback-denied'
  | 'authenticator-replaced'
  | 'lost-device'
  | 'origin-mismatch';

export type WebAuthnCredential = Readonly<{
  getClientExtensionResults(): { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
}>;

export type WebAuthnCeremony = Readonly<{
  detect(): Promise<WebAuthnCapability>;
  create(): Promise<WebAuthnCredential>;
  get(salt: Uint8Array): Promise<WebAuthnCredential>;
  /** Set by browser ceremonies; injected fixtures may use it for origin-negative tests. */
  origin?: string;
}>;

function browserOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

/** Browser implementation kept behind the injectable ceremony boundary. */
export function createBrowserWebAuthnCeremony(
  rpId = typeof location === 'undefined' ? '' : location.hostname,
): WebAuthnCeremony {
  let credentialId: Uint8Array | undefined;
  const publicKeyCredential = typeof PublicKeyCredential === 'undefined' ? undefined : PublicKeyCredential;
  return {
    origin: browserOrigin(),
    async detect(): Promise<WebAuthnCapability> {
      if (!publicKeyCredential || !navigator.credentials) return 'unavailable';
      const capabilities = (
        publicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }
      ).getClientCapabilities;
      if (capabilities) {
        const result = await capabilities();
        if (result['prf'] === true) return 'prf-supported';
      }
      return 'webauthn-supported';
    },
    async create(): Promise<WebAuthnCredential> {
      if (!publicKeyCredential) throw new Error('WebAuthn is unavailable.');
      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: { id: rpId, name: 'Themis' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'themis-vault', displayName: 'Themis vault' },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          extensions: { prf: {} },
        },
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error('WebAuthn credential creation returned no credential.');
      credentialId = new Uint8Array(credential.rawId);
      return credential as unknown as WebAuthnCredential;
    },
    async get(salt: Uint8Array): Promise<WebAuthnCredential> {
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: credentialId ? [{ id: bufferSource(credentialId), type: 'public-key' }] : [],
          userVerification: 'required',
          extensions: { prf: { eval: { first: bufferSource(salt) } } },
        },
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error('WebAuthn assertion returned no credential.');
      return credential as unknown as WebAuthnCredential;
    },
  };
}

export type LocalFallbackPolicy = Readonly<{
  enabled: boolean;
  secret: string;
}>;

export type RecoveryRecord = Readonly<{
  digest: string;
  enrolledAt: string;
  used: boolean;
  revoked: boolean;
}>;

export type RecoveryResult =
  | { state: 'enrolled'; material: string }
  | { state: 'used' }
  | { state: 'revoked' | 'invalid' | 'already-used' | 'confirmation-required' };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function deriveFallbackKey(secret: string, scope: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`themis/local-only-fallback/v1/${scope}`),
      iterations: 210_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export class RecoveryMaterialStore {
  private record: RecoveryRecord | undefined;

  async enroll(confirm: boolean): Promise<RecoveryResult> {
    if (!confirm) return { state: 'invalid' };
    const material = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    this.record = { digest: await digest(material), enrolledAt: new Date().toISOString(), used: false, revoked: false };
    return { state: 'enrolled', material };
  }

  async use(material: string): Promise<RecoveryResult> {
    if (!this.record || this.record.revoked) return { state: 'revoked' };
    if (this.record.used) return { state: 'already-used' };
    if (!(await digest(material)) || (await digest(material)) !== this.record.digest) return { state: 'invalid' };
    this.record = { ...this.record, used: true };
    return { state: 'used' };
  }

  revoke(): void {
    if (this.record) this.record = { ...this.record, revoked: true };
  }

  snapshot(): RecoveryRecord | undefined {
    return this.record;
  }
}

export class WebAuthnPrfAuthenticator implements BrowserVaultAuthenticator {
  private capability: WebAuthnCapability = 'unavailable';
  private readonly recovery = new RecoveryMaterialStore();

  constructor(
    private readonly ceremony: WebAuthnCeremony,
    private readonly scope: string,
    private readonly fallback: LocalFallbackPolicy = { enabled: false, secret: '' },
    private readonly onState: (state: WebAuthnUnlockState) => void = () => undefined,
    private readonly expectedOrigin = browserOrigin(),
  ) {}

  getCapability(): WebAuthnCapability {
    return this.capability;
  }

  async detect(): Promise<WebAuthnCapability> {
    this.assertOrigin();
    this.capability = await this.ceremony.detect();
    this.onState(
      this.capability === 'prf-supported'
        ? 'locked'
        : this.capability === 'webauthn-supported'
          ? 'prf-unavailable'
          : 'platform-error',
    );
    return this.capability;
  }

  async initialize(): Promise<CryptoKey> {
    await this.detect();
    if (this.capability !== 'prf-supported') {
      if (!this.fallback.enabled || this.fallback.secret.length < 12) {
        this.onState('unsafe-fallback-denied');
        throw new Error('A PRF authenticator is required; unsafe local fallback was denied.');
      }
      this.onState('fallback-ready');
      const key = await deriveFallbackKey(this.fallback.secret, this.scope);
      this.onState('ready');
      return key;
    }
    await this.ceremony.create();
    const key = await this.prfKey(await this.ceremony.get(encoder.encode(`themis/prf/${this.scope}/v1`)), 'initialize');
    this.onState('ready');
    return key;
  }

  async unlock(): Promise<CryptoKey> {
    try {
      this.assertOrigin();
      await this.detect();
      if (this.capability !== 'prf-supported') {
        if (!this.fallback.enabled || this.fallback.secret.length < 12) {
          this.onState('unsafe-fallback-denied');
          throw new Error('PRF is unavailable and no approved local-only fallback is configured.');
        }
        this.onState('fallback-ready');
        const key = await deriveFallbackKey(this.fallback.secret, this.scope);
        this.onState('ready');
        return key;
      }
      const key = await this.prfKey(await this.ceremony.get(encoder.encode(`themis/prf/${this.scope}/v1`)), 'unlock');
      this.onState('ready');
      return key;
    } catch (error) {
      if (error instanceof Error && /origin|rp id/i.test(error.message)) this.onState('origin-mismatch');
      else if (error instanceof Error && /lost.?device|device.?lost/i.test(error.message)) this.onState('lost-device');
      else if (error instanceof Error && /authenticator.?replaced|replaced.?authenticator/i.test(error.message))
        this.onState('authenticator-replaced');
      else if (error instanceof Error && /cancel|abort/i.test(error.message)) this.onState('cancelled');
      else if (error instanceof Error && /lockout|locked/i.test(error.message)) this.onState('lockout');
      else if (error instanceof Error && /credential/i.test(error.message)) this.onState('wrong-credential');
      else if (!(error instanceof Error && /fallback|PRF is unavailable/.test(error.message)))
        this.onState('platform-error');
      throw error;
    }
  }

  async enrollRecovery(confirm: boolean): Promise<RecoveryResult> {
    return this.recovery.enroll(confirm);
  }

  async useRecovery(material: string, confirm = false): Promise<RecoveryResult> {
    if (!confirm) {
      this.onState('recovery-required');
      return { state: 'confirmation-required' };
    }
    const result = await this.recovery.use(material);
    this.onState(
      result.state === 'used' ? 'recovery-required' : result.state === 'revoked' ? 'revoked' : 'platform-error',
    );
    return result;
  }

  revokeRecovery(): void {
    this.recovery.revoke();
    this.onState('revoked');
  }

  recoverySnapshot(): RecoveryRecord | undefined {
    return this.recovery.snapshot();
  }

  private async prfKey(credential: WebAuthnCredential, phase: string): Promise<CryptoKey> {
    const result = credential.getClientExtensionResults().prf?.results?.first;
    if (!result) {
      this.onState('prf-unavailable');
      throw new Error(`WebAuthn PRF result was missing during ${phase}.`);
    }
    const base = await crypto.subtle.importKey(
      'raw',
      bufferSource(base64ToBytes(bytesToBase64(new Uint8Array(result)))),
      'HKDF',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(this.scope),
        info: encoder.encode('themis/browser-vault/v1'),
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  private assertOrigin(): void {
    if (this.expectedOrigin && this.ceremony.origin && this.expectedOrigin !== this.ceremony.origin) {
      this.onState('origin-mismatch');
      throw new Error('WebAuthn ceremony origin does not match the browser origin.');
    }
  }
}
