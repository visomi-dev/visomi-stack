import { isPlatformServer } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, REQUEST, inject } from '@angular/core';

import { environment } from '../../environments/environment';

export const httpInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  const request = inject(REQUEST, { optional: true });

  if (!isPlatformServer(platformId)) {
    return next(req);
  }

  if (!req.url.startsWith('/api/')) {
    return next(req);
  }

  const apiBase = resolveServerOrigin(request ?? undefined);
  const cookieHeader = request?.headers.get('cookie');

  const headers = cookieHeader ? req.headers.set('cookie', cookieHeader) : req.headers;

  return next(
    req.clone({
      headers,
      url: `${apiBase}${req.url}`,
    }),
  );
};

function resolveServerOrigin(request: Request | undefined): string {
  if (!request) {
    return environment.internalApiUrl;
  }

  if (request.url.startsWith('http')) {
    try {
      return new URL(request.url).origin;
    } catch {
      return environment.internalApiUrl;
    }
  }

  const protocol = (request as Request & { protocol?: string }).protocol ?? 'http';
  const host = request.headers.get('host') ?? 'localhost:8080';

  return `${protocol}://${host}`;
}
