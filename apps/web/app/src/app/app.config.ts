import { type ApplicationConfig } from '@angular/core';
import { provideClientHydration, withI18nSupport, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { appRoutes } from './app.routes';
import { Session } from './auth/session/session';
import { BrowserSession } from './auth/session/browser-session';

export const appConfig: ApplicationConfig = {
  providers: [
    BrowserSession,
    { provide: Session, useExisting: BrowserSession },
    provideClientHydration(
      withI18nSupport(),
      withHttpTransferCacheOptions({ filter: (request) => !request.url.includes('/auth/') }),
    ),
    provideRouter(appRoutes),
  ],
};
