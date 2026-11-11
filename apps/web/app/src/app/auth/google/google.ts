import { DOCUMENT } from '@angular/common';
import { CSP_NONCE, DestroyRef, LOCALE_ID, Service, afterRenderEffect, inject, signal } from '@angular/core';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';
import type { Pending, SessionView, SessionResult } from '../session/models';
import { Theme } from '../../ui/theme/theme';

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
        options: {
          type: string;
          theme: string;
          size: string;
          width: string;
          text: string;
          shape: string;
          locale: string;
        },
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
  private readonly theme = inject(Theme);
  private readonly locale = inject(LOCALE_ID);

  private readonly width = signal(0);
  private readonly focused = signal(false);

  private readonly renderer = signal<((width: number, dark: boolean) => void) | null>(null);

  private buttonLifetime: AbortController | undefined;
  private readonly cleanup = this.destroyRef.onDestroy(() => this.buttonLifetime?.abort());

  async button(
    element: HTMLElement,
    intent: 'login' | 'link' | 'reauth',
    complete: (result: SessionView | (Pending & { factor: 'email' })) => void,
    failed: (error: unknown) => void,
    allowed: () => boolean = () => true,
    processing: (active: boolean) => void = () => undefined,
  ): Promise<void> {
    this.buttonLifetime?.abort();
    const controller = new AbortController();
    const lifetime = controller.signal;
    const cancellation = this.session.cancellation();

    this.buttonLifetime = controller;

    const pending = await this.http.request<Pending & { clientId: string; nonce: string }>('POST', '/google/start', {
      intent,
    });
    const google = await this.load();

    if (this.destroyRef.destroyed) {
      return;
    }

    lifetime.throwIfAborted();
    cancellation.throwIfAborted();

    let used = false;
    let active = false;

    cancellation.addEventListener(
      'abort',
      () => {
        controller.abort();
        element.replaceChildren();

        if (active) {
          processing(false);
        }

        failed(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true, signal: lifetime },
    );

    google.accounts.id.initialize({
      client_id: pending.clientId,
      nonce: pending.nonce,
      auto_select: false,
      callback: (result) => {
        if (used || lifetime.aborted || cancellation.aborted || !allowed()) {
          return;
        }

        used = true;
        active = true;
        processing(true);
        void this.http
          .request<SessionView | (Pending & { factor: 'email' })>('POST', '/google/complete', {
            flowId: pending.flowId,
            idToken: result.credential,
          })
          .then((value) => {
            if (!lifetime.aborted && !cancellation.aborted) {
              active = false;
              processing(false);
              complete(value);
            }
          })
          .catch((error) => {
            if (!lifetime.aborted && !cancellation.aborted) {
              active = false;
              processing(false);
              failed(error);
            }
          });
      },
    });

    this.width.set(element.clientWidth);
    this.focused.set(false);
    let renderedWidth = 0;
    let renderedDark: boolean | undefined;

    this.renderer.set((width, dark) => {
      const buttonWidth = Math.min(400, Math.floor(width));

      // Never replace controls after credential submission or reuse a consumed nonce.
      if (
        used ||
        lifetime.aborted ||
        cancellation.aborted ||
        (buttonWidth === renderedWidth && dark === renderedDark)
      ) {
        return;
      }

      try {
        element.replaceChildren();
        google.accounts.id.renderButton(element, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          width: String(buttonWidth),
          text: intent === 'link' ? 'continue_with' : 'signin_with',
          shape: 'rectangular',
          locale: this.locale.startsWith('es') ? 'es' : 'en',
        });

        renderedWidth = buttonWidth;
        renderedDark = dark;
      } catch (error) {
        failed(error);
      }
    });

    const observer = new ResizeObserver(() => this.width.set(element.clientWidth));

    observer.observe(element);
    element.addEventListener('focusin', () => this.focused.set(true), { signal: lifetime });
    element.addEventListener('focusout', () => this.focused.set(false), { signal: lifetime });
    lifetime.addEventListener('abort', () => observer.disconnect(), { once: true });
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

      // Google requires an executable external script; Angular templates do not execute script elements.
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

  private readonly updatePresentation = afterRenderEffect({
    write: () => {
      const render = this.renderer();
      const width = this.width();
      const dark = this.theme.isDark();

      // Keep keyboard focus in the provider frame; apply the latest layout when focus leaves it.
      if (render && width > 0 && !this.focused()) {
        render(width, dark);
      }
    },
  });
}
