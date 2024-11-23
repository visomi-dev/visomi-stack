import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  input,
  numberAttribute,
  output,
  viewChildren,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-input',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './pin-input.component.html',
})
export class PinInputComponent {
  readonly pattern = '[0-9a-zA-Z]{1}';

  private commands = ['Backspace', 'ArrowLeft', 'ArrowRight', 'Delete'];
  private sizes: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
    7: 'grid-cols-7',
    8: 'grid-cols-8',
    9: 'grid-cols-9',
    10: 'grid-cols-10',
    11: 'grid-cols-11',
    12: 'grid-cols-12',
  };

  readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('inputs');

  readonly label = input('');
  readonly digits = input(6, { transform: numberAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly completed = output<string>();
  readonly valueChanges = output<string>();

  readonly value = computed(() =>
    Object.values(this.pinFormValue() ?? {}).join(''),
  );

  readonly labelFor = computed(() => {
    return `pin-${this.value().length + 1}`;
  });

  readonly $digits = computed(() =>
    new Array(this.digits()).fill(null).map((_, index) => index + 1),
  );

  readonly controls = computed(() =>
    this.$digits().reduce(
      (accumulator, digit) => ({
        ...accumulator,
        [`pin${digit}FormControl`]: new FormControl(''),
      }),
      {},
    ),
  );

  readonly pinForm = computed(() => new FormGroup(this.controls()));
  readonly pinFormValue = toSignal(this.pinForm().valueChanges);

  readonly gridClass = computed(() => this.sizes[this.digits()]);

  id = (digit: number) => `pin-${digit}`;
  formControlName = (digit: number) => `pin${digit}FormControl`;

  onFocus(event: FocusEvent, digit: number) {
    const value = this.value();

    if (value.length === 0) {
      event.preventDefault();

      const [input] = this.inputs();

      const element = input.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    // permit only focus the last or the current digit, that is the reason for -1
    if (digit - 1 > value.length) {
      event.preventDefault();

      const element = this.inputs()[value.length]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (value.length === this.digits()) {
      event.preventDefault();

      const element = this.inputs()[this.digits() - 1]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }
  }

  onPaste(event: ClipboardEvent) {
    event.preventDefault();

    const values = event.clipboardData?.getData('text').split('');

    if (values?.every((value) => Number.isInteger(parseInt(value, 10)))) {
      values.forEach((value, index) => {
        const controlName = `pin${index + 1}FormControl`;

        this.pinForm().get(controlName)?.setValue(value);
      });
    }
  }

  onKeyUp(event: KeyboardEvent, digit: number) {
    event.preventDefault();

    const value = this.value();

    if (!/\d/.test(event.key) && !this.commands.includes(event.key)) {
      return;
    }

    if (this.commands.includes(event.key) && value.length === 0) {
      return;
    }

    if (event.key === 'ArrowLeft' && value.length > 0) {
      const element = this.inputs()[digit - 2]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (event.key === 'ArrowRight' && digit < value.length) {
      const element = this.inputs()[digit]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (event.key === 'Backspace' && value.length > 0) {
      const value = this.pinForm().get(`pin${digit - 1}FormControl`)?.value;

      if (value) {
        const controlName = `pin${digit}FormControl`;

        this.pinForm().get(controlName)?.setValue('');
      } else {
        const controlName = `pin${digit - 1}FormControl`;

        this.pinForm().get(controlName)?.setValue('');
      }

      const element = this.inputs()[digit - 2]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (!this.commands.includes(event.key) && value.length <= this.digits()) {
      const controlName = `pin${digit}FormControl`;

      this.pinForm().get(controlName)?.setValue(event.key);

      if (value.length < this.digits()) {
        const element = this.inputs()[digit]?.nativeElement;

        if (element) {
          element.focus();
        }
      }

      return;
    }
  }

  readonly disabledEffect = effect(() => {
    const disabled = this.disabled();

    if (disabled) {
      this.pinForm().disable({ emitEvent: false });
    } else {
      this.pinForm().enable({ emitEvent: false });
    }
  });

  readonly valueEffect = effect(() => {
    const value = this.value();

    if (value.length === this.digits()) {
      this.completed.emit(value);
    }

    this.valueChanges.emit(value);
  });
}
