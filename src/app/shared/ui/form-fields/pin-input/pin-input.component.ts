import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  QueryList,
  ViewChildren,
  booleanAttribute,
  computed,
  effect,
  numberAttribute,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-input',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  template: `
    <form class="control flex flex-col" [formGroup]="pinForm">
      <div class="control flex flex-col gap-1">
        <label [for]="labelFor()">
          {{ label }}
        </label>

        <div class="grid gap-2" [ngClass]="gridClass">
          @for (digit of digits$; track digit) {
            <input
              [id]="id(digit)"
              [name]="id(digit)"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="1"
              [pattern]="pattern"
              placeholder="#"
              class="w-full appearance-none rounded-md border-2 border-slate-300 bg-transparent px-3 py-2 text-center placeholder:text-slate-400 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              [ngClass]="{
                'pointer-events-none relative flex items-center justify-center bg-opacity-90 !text-transparent after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent':
                  loading,
              }"
              [formControlName]="formControlName(digit)"
              (keyup)="onKeyUp($event, digit)"
              (focus)="onFocus($event, digit)"
              (paste)="onPaste($event)"
              #inputs
              required
            />
          }
        </div>

        <ng-content />
      </div>
    </form>
  `,
  styles: [],
})
export class PinInputComponent {
  pattern = '[0-9a-zA-Z]{1}';

  @Input({ required: false }) label = '';
  @Input({ required: false, transform: numberAttribute }) digits = 6;
  @Input({ required: false, transform: booleanAttribute }) loading = false;

  @Output() completed = new EventEmitter<string>();
  @Output() valueChanges = new EventEmitter<string>();

  @ViewChildren('inputs') inputs!: QueryList<ElementRef>;

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

  private commands = ['Backspace', 'ArrowLeft', 'ArrowRight', 'Delete'];

  pinForm = new FormGroup(this.controls);

  pinFormValue = toSignal(this.pinForm.valueChanges);

  value = computed(() => {
    return Object.values(this.pinFormValue() ?? {}).join('');
  });

  labelFor = computed(() => {
    return `pin-${this.value().length + 1}`;
  });

  valueEffect = effect(
    () => {
      const value = this.value();

      if (value.length === this.digits) {
        this.completed.emit(value);
      }

      this.valueChanges.emit(value);
    },
    {
      allowSignalWrites: true,
    },
  );

  get digits$() {
    return new Array(this.digits).fill(null).map((_, index) => index + 1);
  }

  get controls() {
    return this.digits$.reduce(
      (accumulator, digit) => ({
        ...accumulator,
        [`pin${digit}FormControl`]: new FormControl(''),
      }),
      {},
    );
  }

  get gridClass() {
    return this.sizes[this.digits];
  }

  id = (digit: number) => `pin-${digit}`;
  formControlName = (digit: number) => `pin${digit}FormControl`;

  @Input() set disabled(value: boolean) {
    if (value) {
      this.pinForm.disable({ emitEvent: false });
    } else {
      this.pinForm.enable({ emitEvent: false });
    }
  }

  onFocus(event: FocusEvent, digit: number) {
    const value = this.value();

    if (value.length === 0) {
      event.preventDefault();

      const [input] = this.inputs.toArray();

      const element = input.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    // permit only focus the last or the current digit, that is the reason for -1
    if (digit - 1 > value.length) {
      event.preventDefault();

      const element = this.inputs.toArray()[value.length]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (value.length === this.digits) {
      event.preventDefault();

      const element = this.inputs.toArray()[this.digits - 1]?.nativeElement;

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

        this.pinForm.get(controlName)?.setValue(value);
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
      const element = this.inputs.toArray()[digit - 2]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (event.key === 'ArrowRight' && digit < value.length) {
      const element = this.inputs.toArray()[digit]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (event.key === 'Backspace' && value.length > 0) {
      const value = this.pinForm.get(`pin${digit - 1}FormControl`)?.value;

      if (value) {
        const controlName = `pin${digit}FormControl`;

        this.pinForm.get(controlName)?.setValue('');
      } else {
        const controlName = `pin${digit - 1}FormControl`;

        this.pinForm.get(controlName)?.setValue('');
      }

      const element = this.inputs.toArray()[digit - 2]?.nativeElement;

      if (element) {
        element.focus();
      }

      return;
    }

    if (!this.commands.includes(event.key) && value.length <= this.digits) {
      const controlName = `pin${digit}FormControl`;

      this.pinForm.get(controlName)?.setValue(event.key);

      if (value.length < this.digits) {
        const element = this.inputs.toArray()[digit]?.nativeElement;

        if (element) {
          element.focus();
        }
      }

      return;
    }
  }
}
