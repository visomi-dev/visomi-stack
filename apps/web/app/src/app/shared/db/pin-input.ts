import {
  afterRenderEffect,
  booleanAttribute,
  Component,
  ElementRef,
  inject,
  input,
  viewChild,
  type WritableSignal,
} from '@angular/core';

import { Field } from '../../ui';

@Component({
  selector: 'app-pin-input',
  templateUrl: './pin-input.html',
  styleUrl: './pin-input.css',
})
export class PinInput {
  private readonly control = viewChild.required<ElementRef<HTMLInputElement>>('control');

  protected readonly field = inject(Field);

  readonly disabled = input(false);
  readonly required = input(false, { transform: booleanAttribute });

  readonly draft = input.required<WritableSignal<string>>();

  // The browser can edit the value and the owner can clear it before Angular renders again.
  // Compare against the live control so clearing wins and ordinary edits keep native selection.
  private readonly syncDraft = afterRenderEffect({
    write: () => {
      const control = this.control().nativeElement;
      const draft = this.draft()();

      if (control.value !== draft) {
        control.value = draft;
      }
    },
  });
}
