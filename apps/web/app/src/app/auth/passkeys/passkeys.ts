import { DestroyRef, Service, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  WebAuthnAbortService,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';
import type { Pending, SessionView } from '../session/models';

export type Passkey = {
  id: string;
  label: string;
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

  private attempt = 0;
  private controller: AbortController | null = null;

  constructor() {
    this.session.cancelled.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cancel());
    this.destroyRef.onDestroy(() => this.cancel());
  }

  cancel(): void {
    this.attempt++;
    this.controller?.abort();
    this.controller = null;
    WebAuthnAbortService.cancelCeremony();
  }

  async register(email?: string): Promise<SessionView & Partial<Pending>> {
    this.cancel();
    const attempt = this.attempt;
    const controller = new AbortController();

    this.controller = controller;

    if (!browserSupportsWebAuthn()) {
      throw new Error('passkey_unavailable');
    }

    const options = await this.http.request<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
      'POST',
      '/passkeys/registration/options',
      email ? { email } : {},
      controller.signal,
    );

    if (this.attempt !== attempt) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    const response = await startRegistration({ optionsJSON: options.options });

    if (this.attempt !== attempt) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    return this.http.request(
      'POST',
      '/passkeys/registration/verify',
      { challengeId: options.challengeId, response },
      controller.signal,
    );
  }

  async authenticate(conditional = false): Promise<SessionView> {
    this.cancel();
    const attempt = this.attempt;
    const controller = new AbortController();

    this.controller = controller;

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

    const options = await this.http.request<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
      'POST',
      '/passkeys/authentication/options',
      {},
      controller.signal,
    );

    if (this.attempt !== attempt) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    const response = await startAuthentication({ optionsJSON: options.options, useBrowserAutofill: conditional });

    if (this.attempt !== attempt) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    return this.http.request(
      'POST',
      '/passkeys/authentication/verify',
      { challengeId: options.challengeId, response },
      controller.signal,
    );
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
}
