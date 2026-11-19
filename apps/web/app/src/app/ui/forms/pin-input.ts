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
  readonly acceptFormattedPaste = input(false, { alias: 'accept-formatted-paste', transform: booleanAttribute });
  readonly type = input<'password' | 'text'>('password');
  readonly autocomplete = input<'off' | 'one-time-code'>('off');
  readonly name = input<string>();
  readonly value = input('');
  readonly touch = output<void>();
  readonly valueChange = output<string>();
  readonly completed = output<void>();

  focus(options?: FocusOptions): void {
    this.control().nativeElement.focus(options);
  }

  protected changeValue(value: string): void {
    if (this.disabled()) {
      return;
    }

    this.valueChange.emit(value);

    if (value.length === this.digits() && /^[0-9]+$/.test(value)) {
      this.completed.emit();
    }
  }

  protected paste(event: ClipboardEvent): void {
    if (!this.acceptFormattedPaste() || event.defaultPrevented) {
      return;
    }

    const text = event.clipboardData?.getData('text/plain') ?? '';
    const digits = text.replace(/[\s-]/g, '');

    if (digits === text || !/^[0-9]+$/.test(digits)) {
      return;
    }

    // Remove formatting before native maxlength can discard trailing digits.
    event.preventDefault();
    const control = this.control().nativeElement;
    const start = control.selectionStart ?? control.value.length;
    const end = control.selectionEnd ?? start;
    const available = this.digits() - (control.value.length - (end - start));

    if (available > 0) {
      control.setRangeText(digits.slice(0, available), start, end, 'end');
      this.changeValue(control.value);
    }
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
