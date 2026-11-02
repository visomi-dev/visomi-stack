import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { Session } from './session';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const origin = inject(DOCUMENT).location?.origin;
  const url = new URL(request.url, origin || 'http://localhost');

  if (
    !origin ||
    url.origin !== origin ||
    !url.pathname.startsWith('/api/') ||
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  ) {
    return next(request);
  }

  const session = inject(Session);

  return from(session.token()).pipe(
    switchMap((token) => next(request.clone({ setHeaders: { 'X-CSRF-Token': token } }))),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.error?.error === 'csrf_invalid') {
        session.invalidateToken();
      }

      return throwError(() => error);
    }),
  );
};
