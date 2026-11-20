import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Service, inject } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { VaultError } from '@visomi-stack/shared-db';

import { Session } from '../../auth/session/session';

/** Same-origin, non-transferable persistence calls; the existing interceptor supplies CSRF on mutations. */
@Service({ autoProvided: false })
export class DatabaseHttp {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  vault(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<unknown> {
    return this.request('vault', path, body, signal, method);
  }

  cloud(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<unknown> {
    return this.request('cloud', path, body, signal, method);
  }

  private async request(
    example: 'vault' | 'cloud',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<unknown> {
    if (
      !this.document.defaultView ||
      !this.session.full() ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      signal?.aborted
    ) {
      throw new VaultError('unavailable');
    }

    const current = this.session.cancellation();
    const version = this.session.operationVersion();
    const controller = new AbortController();
    const cancel = () => controller.abort();

    if (current.aborted) {
      throw new VaultError('locked');
    }

    current.addEventListener('abort', cancel, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    const removeDestroy = this.destroyRef.onDestroy(cancel);
    const timeout = setTimeout(cancel, 15_000);

    try {
      const url = `/api/example/${example}${path}`;
      const request = this.http.request<unknown>(method, url, { body, transferCache: false });
      const result = await firstValueFrom(request.pipe(takeUntil(fromEvent(controller.signal, 'abort'))));

      if (
        controller.signal.aborted ||
        current.aborted ||
        version !== this.session.operationVersion() ||
        !this.session.full()
      ) {
        throw new VaultError('stale-operation');
      }

      return result;
    } finally {
      clearTimeout(timeout);
      current.removeEventListener('abort', cancel);
      signal?.removeEventListener('abort', cancel);
      removeDestroy();
    }
  }
}
