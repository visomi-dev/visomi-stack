import { DestroyRef, Signal, effect, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

import { Auth } from '../auth/auth';
import { Deps } from '../deps';

import { Realtime } from './realtime';
import type { AsyncJobEvent } from './realtime.models';
import type { OperationEvent } from './operation-contract';

@Injectable({ providedIn: 'root' })
export class BrowserRealtime extends Realtime {
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deps = inject(Deps);

  private readonly $connected: WritableSignal<boolean> = signal(false);
  private readonly $lastEvent: WritableSignal<AsyncJobEvent | null> = signal<AsyncJobEvent | null>(null);

  readonly connected: Signal<boolean> = this.$connected.asReadonly();
  readonly lastEvent: Signal<AsyncJobEvent | null> = this.$lastEvent.asReadonly();

  private readonly operations = new Map<string, (event: OperationEvent) => void>();
  private readonly notificationCallbacks = new Set<() => void>();

  private socket: Socket | null = null;
  private ownerKey: string | null = null;

  constructor() {
    super();
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  watchOperation(operationId: string, callback: (event: OperationEvent) => void): () => void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      throw new Error('Invalid operation identifier.');
    }
    if (this.operations.size >= 8 || this.operations.has(operationId))
      throw new Error('Operation watch capacity exceeded.');
    this.operations.set(operationId, callback);
    if (this.socket?.connected) this.socket.emit('operation:watch', { operationId });

    return () => {
      if (this.operations.get(operationId) !== callback) return;
      this.operations.delete(operationId);
      this.socket?.emit('operation:unwatch', { operationId });
    };
  }

  watchNotifications(callback: () => void): () => void {
    if (this.notificationCallbacks.size >= 8) throw new Error('Notification watch capacity exceeded.');
    const first = this.notificationCallbacks.size === 0;

    this.notificationCallbacks.add(callback);
    if (first && this.socket?.connected) this.socket.emit('notifications:watch');

    return () => {
      if (!this.notificationCallbacks.delete(callback)) return;
      if (this.notificationCallbacks.size === 0) this.socket?.emit('notifications:unwatch');
    };
  }

  private connect(): void {
    if (this.socket?.connected) {
      return;
    }

    this.socket?.disconnect();
    this.socket = io('/', {
      autoConnect: true,
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      this.$connected.set(true);
      for (const operationId of this.operations.keys()) this.socket?.emit('operation:watch', { operationId });
      if (this.notificationCallbacks.size) this.socket?.emit('notifications:watch');
    });

    const socket = this.socket;

    this.socket.on('operation:changed', (input: unknown) => {
      void this.dispatchOperation(input, socket);
    });
    this.socket.on('notifications:changed', (input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) return;
      for (const callback of this.notificationCallbacks) callback();
    });

    this.socket.on('disconnect', () => {
      this.$connected.set(false);
    });

    for (const name of ['job:queued', 'job:started', 'job:progress', 'job:completed', 'job:failed'] as const) {
      this.socket.on(name, (event: AsyncJobEvent) => this.$lastEvent.set(event));
    }
  }

  private disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.$connected.set(false);
    this.$lastEvent.set(null);
    const callbacks = [...this.operations];

    this.operations.clear();
    this.notificationCallbacks.clear();
    for (const [operationId, callback] of callbacks)
      callback({ operationId, status: 'failed', error: { code: 'operation_cancelled', status: 409 } });
  }

  private async dispatchOperation(input: unknown, socket: Socket): Promise<void> {
    if (
      typeof input !== 'object' ||
      input === null ||
      !('operationId' in input) ||
      typeof input.operationId !== 'string'
    )
      return;
    const callback = this.operations.get(input.operationId);
    const owner = this.ownerKey;

    if (!callback) return;
    try {
      const { operationEventSchema } = await this.deps.operationContracts();
      const parsed = operationEventSchema.safeParse(input);

      if (
        parsed.success &&
        socket === this.socket &&
        owner === this.ownerKey &&
        this.operations.get(parsed.data.operationId) === callback
      )
        callback(parsed.data);
    } catch {
      /* Optional live hints never bypass authoritative HTTP catch-up. */
    }
  }

  readonly authEffect = effect(() => {
    const user = this.auth.user();

    if (!user) {
      this.disconnect();
      this.ownerKey = null;

      return;
    }

    const key = JSON.stringify([user.id, user.accountId]);

    if (this.ownerKey !== null && this.ownerKey !== key) this.disconnect();
    this.ownerKey = key;
    this.connect();
  });
}
