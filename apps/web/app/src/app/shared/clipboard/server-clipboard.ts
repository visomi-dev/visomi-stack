import { WritableSignal, Injectable, signal } from '@angular/core';

import { Clipboard } from './clipboard';

@Injectable()
export class ServerClipboard extends Clipboard {
  private readonly $available: WritableSignal<boolean> = signal(false);

  readonly available = this.$available.asReadonly();

  async writeText(_value: string): Promise<boolean> {
    return false;
  }
}
