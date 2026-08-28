import { Signal, Injectable, signal, WritableSignal } from '@angular/core';

import { Realtime } from './realtime';
import type { AsyncJobEvent } from './realtime.models';

@Injectable()
export class ServerRealtime extends Realtime {
  private readonly $connected: WritableSignal<boolean> = signal(false);
  private readonly $lastEvent: WritableSignal<AsyncJobEvent | null> = signal<AsyncJobEvent | null>(null);

  readonly connected: Signal<boolean> = this.$connected.asReadonly();
  readonly lastEvent: Signal<AsyncJobEvent | null> = this.$lastEvent.asReadonly();
}
