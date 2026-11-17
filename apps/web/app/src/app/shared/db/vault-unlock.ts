import { Component, computed, effect, input, model, output, untracked } from '@angular/core';
import type { WrappingContext } from '@visomi-stack/shared-db';

import { Button, Field, Heading, Text } from '../../ui';

import { PinInput } from './pin-input';

@Component({
  selector: 'app-vault-unlock',
  imports: [PinInput, Button, Field, Heading, Text],
  templateUrl: './vault-unlock.html',
})
export class VaultUnlock {
  readonly controlId = input.required<string>({ alias: 'control-id' });
  readonly method = input<WrappingContext['method']>();
  readonly busy = input(false);
  readonly notice = input('');
  readonly pin = model('');
  readonly unlock = output<void>();

  readonly headingId = computed(() => `${this.controlId()}-heading`);
  readonly pinId = computed(() => `${this.controlId()}-pin`);

  submit(): void {
    if (!this.busy() && this.method()) {
      this.unlock.emit();
    }
  }

  private readonly contextChanged = effect(() => {
    this.controlId();
    this.method();
    untracked(() => this.pin.set(''));
  });
}
