import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Service, inject } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { VaultError } from '@visomi-stack/shared-persistence';

import { Session } from '../auth/session/session';


/** Same-origin, non-transferable persistence calls; the existing interceptor supplies CSRF on mutations. */
@Service({ autoProvided: false })
export class PersistenceHttp {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
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
      const url = `/api/persistence${path}`;
      const request =
        body === undefined
          ? this.http.get<unknown>(url, { transferCache: false })
          : this.http.post<unknown>(url, body, { transferCache: false });
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
