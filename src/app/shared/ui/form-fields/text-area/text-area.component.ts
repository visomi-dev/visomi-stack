import {
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
  numberAttribute,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-text-area',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './text-area.component.html',
})
export class TextAreaComponent {
  readonly form = input.required<FormGroup>();
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly label = input<string>();
  readonly type = input<(string | 'text' | 'email') | undefined>('text');
  readonly placeholder = input.required<string>();
  readonly pattern = input<string>();
  readonly autocomplete = input<string>();
  readonly minLength = input<string | number, unknown>(undefined, {
    transform: numberAttribute,
  });
  readonly maxLength = input<string | number, unknown>(undefined, {
    transform: numberAttribute,
  });
  readonly min = input<string | number>();
  readonly max = input<string | number>();
  readonly rows = input<string | number>();
  readonly cols = input<string | number>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly readonly = input<boolean, unknown>(undefined, {
    transform: booleanAttribute,
  });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input<string>();
  readonly help = input<string>();
  readonly step = input<string | number>();
  readonly inputClass = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly requiredAttr = computed(() => (this.required() ? true : undefined));
  readonly readonlyAttr = computed(() => (this.readonly() ? true : undefined));
  readonly $inputClass = computed(() => {
    const classes = [];

    const inputClass = this.inputClass();

    if (inputClass) {
      classes.push(inputClass);
    }

    if (this.loading()) {
      classes.push(
        /* tw */ 'pointer-events-none relative flex items-center justify-center bg-opacity-90 text-transparent! after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent',
      );
    }

    return classes.join(' ');
  });

  readonly disabledEffect = effect(() => {
    const control = this.form().get(this.name());

    if (!control) {
      return;
    }

    if (this.disabled()) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  });
}
