import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
  withHttpTransferCacheOptions,
  withI18nSupport,
} from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { appRoutes } from './app.routes';
import { VaultSession } from './vault/vault-session';
import { BrowserVaultSession } from './vault/browser-vault-session';
import { Auth } from './shared/auth/auth';
import { BrowserAuth } from './shared/auth/browser-auth';
import { Clipboard } from './shared/clipboard/clipboard';
import { BrowserClipboard } from './shared/clipboard/browser-clipboard';
import { httpInterceptor } from './shared/http-interceptor';
import { Realtime } from './shared/realtime/realtime';
import { BrowserRealtime } from './shared/realtime/browser-realtime';
import { BrowserSettings } from './shared/browser-settings';
import { Settings } from './shared/settings';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([httpInterceptor])),
    provideClientHydration(
      withI18nSupport(),
      withEventReplay(),
      withHttpTransferCacheOptions({
        filter: (req) => !req.url.includes('/api/auth/'),
      }),
    ),
    provideRouter(appRoutes),
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    provideAppInitializer(() => inject(Auth).ensureSessionLoaded()),

    { provide: Auth, useExisting: BrowserAuth },
    { provide: Settings, useExisting: BrowserSettings },
    { provide: Realtime, useExisting: BrowserRealtime },
    { provide: Clipboard, useExisting: BrowserClipboard },
    { provide: VaultSession, useExisting: BrowserVaultSession },
  ],
};
