import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
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

import { appRoutes } from './app.routes';
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
    provideAppInitializer(() => inject(Auth).ensureSessionLoaded()),

    { provide: Auth, useExisting: BrowserAuth },
    { provide: Settings, useExisting: BrowserSettings },
    { provide: Realtime, useExisting: BrowserRealtime },
    { provide: Clipboard, useExisting: BrowserClipboard },
  ],
};
