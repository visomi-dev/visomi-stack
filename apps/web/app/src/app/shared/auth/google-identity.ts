import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { AuthUser, ResponseEnvelope } from './auth.models';

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        nonce: string;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, string>): void;
    };
  };
};

@Injectable({ providedIn: 'root' })
export class GoogleIdentity {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private scriptPromise?: Promise<void>;

  async renderButton(
    element: HTMLElement,
    clientId: string,
    flowId: string,
    nonce: string,
    onComplete: (user: AuthUser) => void,
  ): Promise<void> {
    await this.render(element, clientId, nonce, async (credential) => {
      const response = await firstValueFrom(
        this.http.post<ResponseEnvelope<{ authenticated: true; user: AuthUser }>>('/api/auth/google/complete', {
          flowId,
          idToken: credential,
        }),
      );

      onComplete(response.data.user);
    });
  }

  async renderLinkButton(
    element: HTMLElement,
    clientId: string,
    grantId: string,
    nonce: string,
    onComplete: () => void,
  ): Promise<void> {
    await this.render(element, clientId, nonce, async (credential) => {
      await firstValueFrom(this.http.post('/api/auth/google/link', { grantId, idToken: credential }));
      onComplete();
    });
  }

  private async render(
    element: HTMLElement,
    clientId: string,
    nonce: string,
    onCredential: (credential: string) => Promise<void>,
  ): Promise<void> {
    const view = this.document.defaultView;

    if (!view) throw new Error('Google sign-in is unavailable during server rendering.');
    await this.loadScript();
    const google = (view as Window & { google?: GoogleIdentityApi }).google;

    if (!google) throw new Error('Google sign-in could not be loaded.');
    google.accounts.id.initialize({
      client_id: clientId,
      nonce,
      use_fedcm_for_prompt: true,
      callback: async ({ credential }) => {
        await onCredential(credential);
      },
    });
    google.accounts.id.renderButton(element, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: '320',
    });
  }

  private loadScript(): Promise<void> {
    if (this.scriptPromise) return this.scriptPromise;
    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const script = this.document.createElement('script');

      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      this.document.head.appendChild(script);
    });

    return this.scriptPromise;
  }
}
