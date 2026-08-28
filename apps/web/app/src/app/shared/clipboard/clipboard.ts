import type { Signal } from '@angular/core';

export abstract class Clipboard {
  abstract readonly available: Signal<boolean>;

  abstract writeText(value: string): Promise<boolean>;
}
