import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../environments/environment';
import { ACCESS_TOKEN_KEY } from '../config/storage';

export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.url.startsWith('http')) {
    return next(request);
  }

  return next(
    request.clone({
      url: `${environment.apiUrl}${request.url}`,
      setHeaders: {
        Authorization: `Bearer ${localStorage.getItem(ACCESS_TOKEN_KEY)}`,
      },
    }),
  );
};
