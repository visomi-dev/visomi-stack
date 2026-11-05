import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { DestroyRef, Service, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NEVER, firstValueFrom, fromEvent, takeUntil, tap } from 'rxjs';

import { Session } from '../session/session';
import { isSession } from '../session/models';

@Service({ autoProvided: false })
export class AuthHttp {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const version = this.session.operationVersion();

    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        await this.session.token();
      }

      if (version !== this.session.operationVersion()) {
        throw new DOMException('Cancelled', 'AbortError');
      }

      if (signal?.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
      }

      const result = await firstValueFrom(
        this.http.request<T>(method, '/api/auth' + path, { body, transferCache: false }).pipe(
          takeUntilDestroyed(this.destroyRef),
          takeUntil(this.session.cancelled),
          takeUntil(signal ? fromEvent(signal, 'abort') : NEVER),
          tap((result) => {
            if (isSession(result)) {
              if (version !== this.session.operationVersion()) {
                throw new DOMException('Cancelled', 'AbortError');
              }

              this.session.accept(result);
            }
          }),
        ),
      );

      return result;
    } catch (error) {
      if (signal?.aborted || version !== this.session.operationVersion()) {
        throw new DOMException('Cancelled', 'AbortError');
      }

      if (
        error instanceof HttpErrorResponse &&
        (['session_expired', 'authentication_required'].includes(error.error?.error) ||
          (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (error.status === 0 || error.status >= 500)))
      ) {
        await this.session.load(true);
      }

      throw error;
    }
  }
}

export function retryDelay(headers: HttpHeaders): number | null {
  const value = headers.get('retry-after');

  if (!value) {
    return null;
  }

  const seconds = Number(value);

  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}
