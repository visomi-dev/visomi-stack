import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { AuthUser, ResponseEnvelope } from './auth.models';

type PasskeyBegin = ResponseEnvelope<{
  challengeId: string | null;
  expiresAt?: string;
  verificationChallengeId?: string | null;
  enrollmentId?: string | null;
  options: Record<string, unknown> | null;
  attempt?: 'passkey_default' | 'retry_available' | 'authenticated';
}>;

type PasskeyComplete = ResponseEnvelope<{ authenticated: true; user: AuthUser }>;
type PasskeyRegistrationComplete = ResponseEnvelope<{
  credential: PasskeyCredential;
  restrictedSession?: { verificationChallengeId: string; verificationOptions: Record<string, unknown> };
}>;
export type PasskeyCredential = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
};

@Injectable({ providedIn: 'root' })
export class Passkey {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);

  isSupported(): boolean {
    return typeof this.document.defaultView?.PublicKeyCredential !== 'undefined';
  }

  async supportsConditionalAuthentication(): Promise<boolean> {
    const view = this.document.defaultView;
    const credential = view?.PublicKeyCredential;

    if (!view?.isSecureContext || !view.navigator.credentials || !credential) return false;
    try {
      if (credential.getClientCapabilities) {
        const capabilities = await credential.getClientCapabilities();

        if (typeof capabilities['conditionalGet'] === 'boolean') return capabilities['conditionalGet'];
      }

      return (await credential.isConditionalMediationAvailable?.()) === true;
    } catch {
      return false;
    }
  }

  async supportsImmediateAuthentication(): Promise<boolean> {
    const view = this.document.defaultView;

    if (!view?.isSecureContext || !view.navigator.credentials) return false;
    try {
      return (await view.PublicKeyCredential?.getClientCapabilities?.())?.['immediateGet'] === true;
    } catch {
      return false;
    }
  }

  async getImmediateCredential(options: Record<string, unknown>): Promise<Credential> {
    const view = this.document.defaultView;

    if (!view?.navigator.credentials) throw new Error('WebAuthn is unavailable.');
    const request: CredentialRequestOptions & { uiMode: 'immediate' } = {
      publicKey: decodeOptions({ ...options, allowCredentials: [] }) as unknown as PublicKeyCredentialRequestOptions,
      uiMode: 'immediate',
    };
    const credential = await view.navigator.credentials.get(request);

    if (!credential) throw new DOMException('Sign-in was not completed.', 'NotAllowedError');

    return credential;
  }

  async beginAuthentication(retryRequested = false): Promise<PasskeyBegin['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyBegin>('/api/auth/passkey/authentication/begin', { retryRequested }),
    );

    return response.data;
  }

  async beginRegistration(label: string): Promise<PasskeyBegin['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyBegin>('/api/auth/passkey/registration/begin', { label }),
    );

    return response.data;
  }

  async beginSignUp(email: string): Promise<PasskeyBegin['data']> {
    const response = await firstValueFrom(this.http.post<PasskeyBegin>('/api/auth/passkey/sign-up/begin', { email }));

    return response.data;
  }

  async completeSignUp(challengeId: string, credential: Credential): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/passkey/sign-up/complete', { challengeId, response: serializeCredential(credential) }),
    );
  }

  async verifySignUp(code: string): Promise<PasskeyComplete['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyComplete>('/api/auth/passkey/sign-up/verify', { code }),
    );

    return response.data;
  }

  async completeAuthentication(challengeId: string, credential: Credential): Promise<PasskeyComplete['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyComplete>('/api/auth/passkey/authentication/complete', {
        challengeId,
        response: serializeCredential(credential),
      }),
    );

    return response.data;
  }

  async completeRegistration(
    challengeId: string,
    credential: Credential,
  ): Promise<PasskeyRegistrationComplete['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyRegistrationComplete>('/api/auth/passkey/registration/complete', {
        challengeId,
        response: serializeCredential(credential),
      }),
    );

    return response.data;
  }

  async verifyRegistration(challengeId: string, credential: Credential): Promise<PasskeyComplete['data']> {
    const response = await firstValueFrom(
      this.http.post<PasskeyComplete>('/api/auth/passkey/registration/verify', {
        challengeId,
        response: serializeCredential(credential),
      }),
    );

    return response.data;
  }

  async getCredential(
    options: Record<string, unknown>,
    request: { mediation?: 'conditional' | 'required'; signal?: AbortSignal } = {},
  ): Promise<Credential> {
    const view = this.document.defaultView;

    if (!view?.navigator.credentials) {
      throw new Error('WebAuthn is not supported in this browser.');
    }

    const credential = await view.navigator.credentials.get({
      publicKey: decodeOptions(options) as unknown as PublicKeyCredentialRequestOptions,
      ...request,
    });

    if (!credential) {
      throw new DOMException('The passkey ceremony was cancelled.', 'AbortError');
    }

    return credential;
  }

  async createCredential(options: Record<string, unknown>): Promise<Credential> {
    const view = this.document.defaultView;

    if (!view?.navigator.credentials) {
      throw new Error('WebAuthn is not supported in this browser.');
    }

    const credential = await view.navigator.credentials.create({
      publicKey: decodeOptions(options) as unknown as PublicKeyCredentialCreationOptions,
    });

    if (!credential) {
      throw new DOMException('The passkey ceremony was cancelled.', 'AbortError');
    }

    return credential;
  }

  async listCredentials(): Promise<PasskeyCredential[]> {
    const response = await firstValueFrom(
      this.http.get<ResponseEnvelope<{ credentials: PasskeyCredential[] }>>('/api/auth/passkey/credentials'),
    );

    return response.data.credentials;
  }

  async renameCredential(id: string, label: string): Promise<PasskeyCredential> {
    const response = await firstValueFrom(
      this.http.patch<ResponseEnvelope<PasskeyCredential>>(`/api/auth/passkey/credentials/${encodeURIComponent(id)}`, {
        label,
      }),
    );

    return response.data;
  }

  async revokeCredential(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/auth/passkey/credentials/${encodeURIComponent(id)}`));
  }
}

function serializeCredential(credential: Credential): Record<string, unknown> {
  const publicKey = credential as PublicKeyCredential;
  const response = publicKey.response as AuthenticatorAssertionResponse | AuthenticatorAttestationResponse;
  const encoded = (value: ArrayBuffer): string => {
    const bytes = new Uint8Array(value);
    let binary = '';

    for (const byte of bytes) binary += String.fromCharCode(byte);

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  };

  const result: Record<string, unknown> = {
    id: credential.id,
    rawId: encoded(publicKey.rawId),
    response: { clientDataJSON: encoded(response.clientDataJSON) },
    type: credential.type,
  };

  if ('authenticatorData' in response) {
    result['response'] = {
      ...(result['response'] as Record<string, unknown>),
      authenticatorData: encoded(response.authenticatorData),
      signature: encoded(response.signature),
      userHandle: response.userHandle ? encoded(response.userHandle) : null,
    };
  } else {
    result['response'] = {
      ...(result['response'] as Record<string, unknown>),
      attestationObject: encoded(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    };
  }

  return result;
}

function decodeOptions(options: Record<string, unknown>): Record<string, unknown> {
  const decode = (value: unknown): ArrayBuffer | unknown => {
    if (typeof value !== 'string') return value;
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));

    return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
  };

  return {
    ...options,
    challenge: decode(options['challenge']),
    user:
      options['user'] && typeof options['user'] === 'object'
        ? {
            ...(options['user'] as Record<string, unknown>),
            id: decode((options['user'] as Record<string, unknown>)['id']),
          }
        : options['user'],
    allowCredentials: decodeDescriptors(options['allowCredentials'], decode),
    excludeCredentials: decodeDescriptors(options['excludeCredentials'], decode),
  };
}

function decodeDescriptors(value: unknown, decode: (value: unknown) => unknown): unknown {
  if (!Array.isArray(value)) return value;

  return value.map((descriptor) =>
    descriptor && typeof descriptor === 'object'
      ? { ...(descriptor as Record<string, unknown>), id: decode((descriptor as Record<string, unknown>)['id']) }
      : descriptor,
  );
}
