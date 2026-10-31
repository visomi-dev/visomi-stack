import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { BrowserTelemetry } from './browser-telemetry';

export const browserErrorsInterceptor: HttpInterceptorFn = (req, next) => {
  const telemetry = inject(BrowserTelemetry);
  const browser = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(DOCUMENT).defaultView : null;

  return next(req).pipe(
    catchError((error: unknown) => {
      if (browser && error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)) {
        let endpoint: URL | undefined;

        try {
          endpoint = new URL(req.url, browser.location.origin);
        } catch {
          // An invalid request URL is still propagated to the caller unchanged.
        }

        if (endpoint?.origin === browser.location.origin && endpoint.pathname.startsWith('/api/')) {
          telemetry.report('request_failed', undefined, error.headers.get('x-telemetry-context') ?? undefined);
        }
      }

      return throwError(() => error);
    }),
  );
};
