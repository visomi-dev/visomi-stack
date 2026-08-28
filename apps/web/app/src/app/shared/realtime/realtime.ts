import type { Signal } from '@angular/core';

import type { AsyncJobEvent } from './realtime.models';

export abstract class Realtime {
  abstract readonly connected: Signal<boolean>;
  abstract readonly lastEvent: Signal<AsyncJobEvent | null>;
}
