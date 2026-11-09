import { type ApplicationConfig } from '@angular/core';
import { provideClientHydration, withI18nSupport, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(
      withI18nSupport(),
      withHttpTransferCacheOptions({ filter: (request) => !request.url.includes('/auth/') }),
    ),
    provideRouter(appRoutes),
  ],
};
