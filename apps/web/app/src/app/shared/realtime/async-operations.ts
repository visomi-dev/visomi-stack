import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Service } from '@angular/core';
import { DateTime } from 'luxon';
import { timeout } from 'rxjs';
import type { Subscription } from 'rxjs';

import { Realtime } from './realtime';
import { operationEventSchema, operationTicketSchema } from './operation-contract';
import type { OperationEvent, OperationTicket } from './operation-contract';

@Service()
export class AsyncOperations {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(Realtime);
  private readonly destroyRef = inject(DestroyRef);

  private readonly cancelPending = new Set<() => void>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const cancel of [...this.cancelPending]) cancel();
    });
  }

  /** Live delivery is a hint; bounded HTTP catch-up recovers dropped events and reconnects. */
  wait(input: OperationTicket, signal?: AbortSignal): Promise<{ jobId: string }> {
    const ticket = operationTicketSchema.parse(input);
    const remaining = DateTime.fromISO(ticket.expiresAt, { zone: 'utc' }).toMillis() - DateTime.utc().toMillis();

    if (signal?.aborted) return Promise.reject(new Error('operation_cancelled'));
    if (remaining <= 0 || remaining > 600000) return Promise.reject(new Error('operation_expired'));

    return new Promise((resolve, reject) => {
      let done = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      let request: Subscription | undefined;
      let unwatch: () => void = () => undefined;
      const cleanup = () => {
        done = true;
        if (poll) clearTimeout(poll);
        clearTimeout(expiry);
        request?.unsubscribe();
        unwatch();
        signal?.removeEventListener('abort', cancel);
        this.cancelPending.delete(cancel);
      };
      const cancel = () => {
        if (!done) {
          cleanup();
          reject(new Error('operation_cancelled'));
        }
      };
      const receive = (event: OperationEvent) => {
        if (done || event.operationId !== ticket.operationId) return;
        if (event.status === 'completed' || event.status === 'failed') {
          cleanup();
          if (event.status === 'completed' && event.result) resolve(event.result);
          else reject(new Error(event.error?.code ?? 'operation_unavailable'));
        }
      };
      const expiry = setTimeout(() => {
        if (!done) {
          cleanup();
          reject(new Error('operation_expired'));
        }
      }, remaining);
      const fetch = () => {
        if (done) return;
        request = this.http
          .get<unknown>(`/api/operations/${ticket.operationId}`)
          .pipe(timeout(10_000))
          .subscribe({
            next: (input) => {
              const envelope = typeof input === 'object' && input !== null && 'data' in input ? input.data : null;
              const parsed = operationEventSchema.safeParse(envelope);

              if (parsed.success && parsed.data.operationId === ticket.operationId) receive(parsed.data);
              else {
                cleanup();
                reject(new Error('operation_response_invalid'));
              }
              if (!done) poll = setTimeout(fetch, 1000);
            },
            error: (error: unknown) => {
              if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
                cleanup();
                reject(new Error('operation_unavailable'));
              } else if (!done) poll = setTimeout(fetch, 2000);
            },
          });
      };

      try {
        unwatch = this.realtime.watchOperation(ticket.operationId, receive);
      } catch (error) {
        cleanup();
        reject(error);

        return;
      }
      if (done) {
        unwatch();

        return;
      }
      this.cancelPending.add(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      fetch();
    });
  }
}
