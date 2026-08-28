import { Signal, effect, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

import { Auth } from '../auth/auth';

import { Realtime } from './realtime';
import type { AsyncJobEvent } from './realtime.models';

@Injectable({ providedIn: 'root' })
export class BrowserRealtime extends Realtime {
  private readonly auth = inject(Auth);
  private readonly $connected: WritableSignal<boolean> = signal(false);
  private readonly $lastEvent: WritableSignal<AsyncJobEvent | null> = signal<AsyncJobEvent | null>(null);

  private socket: Socket | null = null;

  readonly connected: Signal<boolean> = this.$connected.asReadonly();
  readonly lastEvent: Signal<AsyncJobEvent | null> = this.$lastEvent.asReadonly();

  readonly authEffect = effect(() => {
    const user = this.auth.user();

    if (!user) {
      this.disconnect();

      return;
    }

    this.connect();
  });

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
  }
}
