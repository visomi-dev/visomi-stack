import {
  afterEveryRender,
  booleanAttribute,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Field } from './field';

@Component({
  selector: 'app-pin-input',
  templateUrl: './pin-input.html',
  host: { '[style.--digits]': 'digits()' },
  styleUrl: './pin-input.css',
})
export class PinInput {
  private readonly control = viewChild.required<ElementRef<HTMLInputElement>>('control');

  protected readonly field = inject(Field);

  readonly digits = input(6);
  protected readonly slots = computed(() => Array.from({ length: this.digits() }, (_, index) => index));

  readonly minlength = input<number>();
  protected readonly minDigits = computed(() => this.minlength() ?? this.digits());
  protected readonly pattern = computed(() => `[0-9]{${this.minDigits()},${this.digits()}}`);

  readonly disabled = input(false);
  readonly required = input(false, { transform: booleanAttribute });
  readonly type = input<'password' | 'text'>('password');
  readonly autocomplete = input<'off' | 'one-time-code'>('off');
  readonly name = input<string>();
  readonly value = input('');
  readonly touch = output<void>();
  readonly valueChange = output<string>();

  focus(options?: FocusOptions): void {
    this.control().nativeElement.focus(options);
  }

  protected changeValue(value: string): void {
    this.valueChange.emit(value);
  }

  protected markTouched(): void {
    this.touch.emit();
  }

  // The browser can edit the value and the owner can clear it before Angular renders again.
  // Compare against the live control so clearing wins and ordinary edits keep native selection.
  private readonly syncValue = afterEveryRender({
    write: () => {
      const control = this.control().nativeElement;
      const value = this.value();

      if (control.value !== value) {
        control.value = value;
      }
    },
  });
}
