import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { type ApplicationConfig, ErrorHandler, inject, provideAppInitializer } from '@angular/core';
import { provideClientHydration, withI18nSupport } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { appRoutes } from './app.routes';
import { BrowserErrors } from './observability/browser-errors';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withI18nSupport()),
    { provide: ErrorHandler, useExisting: BrowserErrors },
    provideAppInitializer(() => {
      inject(BrowserErrors);
    }),
    provideHttpClient(
      withInterceptors([
        (request, next) => {
          const errors = inject(BrowserErrors);

          return next(request).pipe(
            catchError((error: unknown) => {
              errors.requestFailed(request.url, error);

              return throwError(() => error);
            }),
          );
        },
      ]),
    ),
    provideRouter(appRoutes),
  ],
};
