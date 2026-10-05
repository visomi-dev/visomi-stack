import type { Signal } from '@angular/core';

import type { AsyncJobEvent } from './realtime.models';
import type { OperationEvent } from './operation-contract';

export abstract class Realtime {
  abstract readonly connected: Signal<boolean>;
  abstract readonly lastEvent: Signal<AsyncJobEvent | null>;

  abstract watchOperation(operationId: string, callback: (event: OperationEvent) => void): () => void;

  abstract watchNotifications(callback: () => void): () => void;
}
