import { DOCUMENT } from '@angular/common';
import { CSP_NONCE, DestroyRef, Service, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';
import type { Pending, SessionView, SessionResult } from '../session/models';

type GoogleApi = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        auto_select: boolean;
        callback: (result: { credential: string }) => void;
      }): void;
      renderButton(
        element: HTMLElement,
        options: { type: string; theme: string; size: string; width: number; text: string },
      ): void;
      cancel(): void;
    };
  };
};
let library: Promise<GoogleApi> | null = null;

@Service({ autoProvided: false })
export class Google {
  private readonly document = inject(DOCUMENT);
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private readonly http = inject(AuthHttp);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(Session);

  private alive = true;
  private epoch = 0;

  constructor() {
    this.session.cancelled.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.epoch++);
    this.destroyRef.onDestroy(() => {
      this.alive = false;
      this.epoch++;
    });
  }

  async button(
    element: HTMLElement,
    intent: 'login' | 'link' | 'reauth',
    complete: (result: SessionView | (Pending & { factor: 'email' })) => void,
    failed: (error: unknown) => void,
    allowed: () => boolean = () => true,
    processing: (active: boolean) => void = () => undefined,
  ): Promise<void> {
    const epoch = ++this.epoch;
    const pending = await this.http.request<Pending & { clientId: string; nonce: string }>('POST', '/google/start', {
      intent,
    });
    const google = await this.load();

    if (!this.alive || epoch !== this.epoch) {
      return;
    }

    let used = false;

    google.accounts.id.initialize({
      client_id: pending.clientId,
      nonce: pending.nonce,
      auto_select: false,
      callback: (result) => {
        if (used || !this.alive || epoch !== this.epoch || !allowed()) {
          return;
        }

        used = true;
        processing(true);
        void this.http
          .request<SessionView | (Pending & { factor: 'email' })>('POST', '/google/complete', {
            flowId: pending.flowId,
            idToken: result.credential,
          })
          .then((value) => {
            if (this.alive && epoch === this.epoch) {
              processing(false);
              complete(value);
            }
          })
          .catch((error) => {
            if (this.alive && epoch === this.epoch) {
              processing(false);
              failed(error);
            }
          });
      },
    });
    google.accounts.id.renderButton(element, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: Math.min(360, element.clientWidth || 300),
      text: intent === 'link' ? 'continue_with' : 'signin_with',
    });
  }

  verify(flowId: string, code: string): Promise<SessionView> {
    return this.http.request('POST', '/google/email/verify', { flowId, code });
  }

  unlink(id: string): Promise<SessionResult | null> {
    return this.http.request('DELETE', '/google/' + encodeURIComponent(id));
  }

  private load(): Promise<GoogleApi> {
    const view = this.document.defaultView as (Window & { google?: GoogleApi }) | null;

    if (view?.google) {
      return Promise.resolve(view.google);
    }

    if (library) {
      return library;
    }

    library = new Promise((resolve, reject) => {
      if (!view) {
        reject(new Error('browser_required'));

        return;
      }

      const script = this.document.createElement('script');

      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;

      if (this.nonce) {
        script.nonce = this.nonce;
      }

      const timer = view.setTimeout(() => {
        script.remove();
        library = null;
        reject(new Error('google_unavailable'));
      }, 15000);

      script.onload = () => {
        view.clearTimeout(timer);

        if (view.google) {
          resolve(view.google);
        } else {
          library = null;
          reject(new Error('google_unavailable'));
        }
      };
      script.onerror = () => {
        view.clearTimeout(timer);
        script.remove();
        library = null;
        reject(new Error('google_unavailable'));
      };
      this.document.head.append(script);
    });

    return library;
  }
}
