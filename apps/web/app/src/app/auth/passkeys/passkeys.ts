import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, inject } from '@angular/core';
import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  WebAuthnAbortService,
  sendSignal,
  bufferToBase64URLString,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';
import type { Pending, SessionView } from '../session/models';

export type Passkey = {
  id: string;
  label: string;
  labelIsCustom?: boolean | null;
  providerName?: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backupEligible: boolean;
  backupState: boolean;
};

@Service({ autoProvided: false })
export class Passkeys {
  private readonly http = inject(AuthHttp);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);

  private readonly cleanup = this.destroyRef.onDestroy(() => this.cancel());

  private controller: AbortController | null = null;

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    WebAuthnAbortService.cancelCeremony();
  }

  async register(email?: string): Promise<SessionView & Partial<Pending>> {
    const signal = this.begin();

    if (!browserSupportsWebAuthn()) {
      throw new Error('passkey_unavailable');
    }

    const options = await this.http.request<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
      'POST',
      '/passkeys/registration/options',
      email ? { email } : {},
      signal,
    );

    signal.throwIfAborted();

    const response = await startRegistration({ optionsJSON: options.options });

    signal.throwIfAborted();

    return this.http.request(
      'POST',
      '/passkeys/registration/verify',
      { challengeId: options.challengeId, response },
      signal,
    );
  }

  async authenticate(conditional = false): Promise<SessionView> {
    const signal = this.begin();

    if (!browserSupportsWebAuthn()) {
      throw new Error('passkey_unavailable');
    }

    let autofill = true;

    if (conditional) {
      const supported = await browserSupportsWebAuthnAutofill();

      autofill = supported;
    }

    if (!autofill) {
      throw new DOMException('Unavailable', 'AbortError');
    }

    signal.throwIfAborted();

    const options = await this.http.request<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
      'POST',
      '/passkeys/authentication/options',
      {},
      signal,
    );

    signal.throwIfAborted();

    const response = await startAuthentication({ optionsJSON: options.options, useBrowserAutofill: conditional });

    signal.throwIfAborted();

    const result = await this.http.request<SessionView>(
      'POST',
      '/passkeys/authentication/verify',
      { challengeId: options.challengeId, response },
      signal,
    );

    signal.throwIfAborted();

    if (result.access === 'full' && result.user?.email && options.options.rpId) {
      await this.updateSavedName(options.options.rpId, result.user.id, result.user.email, signal).catch(
        () => undefined,
      );

      signal.throwIfAborted();
    }

    return result;
  }

  list(): Promise<{ credentials: Passkey[] }> {
    return this.http.request('GET', '/passkeys');
  }

  rename(id: string, label: string): Promise<void> {
    return this.http.request('PATCH', '/passkeys/' + encodeURIComponent(id), { label });
  }

  revoke(id: string): Promise<void> {
    return this.http.request('DELETE', '/passkeys/' + encodeURIComponent(id));
  }

  private async updateSavedName(rpId: string, userId: string, email: string, signal: AbortSignal): Promise<void> {
    const view = this.document.defaultView;

    if (!view) {
      return;
    }

    const encoder = new TextEncoder();
    const [account, details] = await Promise.all([
      view.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([rpId, userId]))),
      view.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([rpId, userId, email]))),
    ]);

    signal.throwIfAborted();
    const storage = view.localStorage;
    const key = `visomi.passkey-name.${bufferToBase64URLString(account)}`;
    const marker = bufferToBase64URLString(details);
    const previous = storage.getItem(key);

    if (previous === marker) {
      return;
    }

    // Reserve the update before signaling. A browser that cannot retain the marker skips the optional update.
    storage.setItem(key, marker);

    void sendSignal({
      signalName: 'currentUserDetails',
      rpID: rpId,
      userID: bufferToBase64URLString(encoder.encode(userId).buffer),
      userName: email,
      userDisplayName: email,
    })
      .catch(() => {
        if (storage.getItem(key) === marker) {
          if (previous === null) {
            storage.removeItem(key);
          } else {
            storage.setItem(key, previous);
          }
        }
      })
      .catch(() => undefined);
  }

  private begin(): AbortSignal {
    this.cancel();
    const cancellation = this.session.cancellation();
    const controller = new AbortController();

    cancellation.throwIfAborted();
    this.controller = controller;
    cancellation.addEventListener('abort', () => this.cancel(), { once: true, signal: controller.signal });

    return controller.signal;
  }
}
