import {
  afterNextRender,
  booleanAttribute,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  numberAttribute,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { Icon } from '../../media/icon/icon';
import { PasswordStrength } from '../password-strength/password-strength';
import { uiClass } from '../../classes';
import { passwordLength } from '../../../auth/password-validation';

type PasswordVariant = 'icon' | 'text';

@Component({
  host: {
    class: /* tw */ 'block',
  },
  imports: [Icon, PasswordStrength],
  selector: 'app-password-input',
  templateUrl: './password-input.html',
  styleUrl: './password-input.css',
})
export class PasswordInput {
  protected readonly ready = signal(false);
  private readonly enableInputAfterRender = afterNextRender(() => this.ready.set(true));
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  readonly formField = input.required<Field<string>>();
  readonly ariaDescribedBy = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly controlId = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly showStrength = input(false, { transform: booleanAttribute });
  readonly meetsLength = computed(() => {
    const length = passwordLength(this.formField()().value());

    return length >= 12 && length <= 128;
  });
  readonly maxLength = input<number | null, unknown>(null, {
    transform: (value) => (value == null ? null : numberAttribute(value)),
  });
  readonly minLength = input(0, { transform: numberAttribute });
  readonly name = input<string | null>(null);
  readonly pattern = input<string | null>(null);
  readonly placeholder = input('');
  readonly required = input(false, { transform: booleanAttribute });
  readonly variant = input<PasswordVariant>('text');
  readonly valueChange = output<string>();

  readonly type = signal<'password' | 'text'>('password');

  readonly isTextVariant = computed(() => this.variant() === 'text');
  readonly isVisible = computed(() => this.type() === 'text');
  readonly isFilled = signal(false);

  readonly ariaLabel = computed(() => (this.isVisible() ? 'Hide password' : 'Show password'));
  readonly toggleLabel = computed(() => (this.isVisible() ? 'Hide' : 'Show'));

  readonly inputClasses = computed(() =>
    uiClass(
      'ui-focus-ring w-full rounded-[var(--radius-control)] border bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-950 dark:text-slate-50 placeholder:text-slate-500 dark:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
      this.isTextVariant() ? 'pr-16' : 'pr-12',
      'border-[color:var(--color-border)] focus-visible:border-slate-600 dark:border-slate-500',
      this.loading() && 'pointer-events-none !text-transparent',
    ),
  );

  readonly toggleClasses = computed(() => {
    if (this.isTextVariant()) {
      return uiClass(
        'ui-focus-ring ui-touch-target text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:text-slate-50 absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] px-2 font-mono text-[0.6875rem] font-semibold tracking-wider uppercase',
        !this.isFilled() && 'pointer-events-none opacity-0',
      );
    }

    return uiClass(
      'ui-focus-ring ui-touch-target absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-slate-500 dark:text-slate-400 transition hover:text-slate-950 dark:text-slate-50',
      !this.isFilled() && 'pointer-events-none opacity-0',
    );
  });

  private readonly syncEffect = effect(() => {
    const ref = this.inputRef();
    const value = this.formField()().value();

    if (ref) {
      ref.nativeElement.value = value ?? '';
      this.isFilled.set((value ?? '').length > 0);
    }
  });

  onInput(event: Event): void {
    const nextValue = (event.target as HTMLInputElement).value;

    this.formField()().value.set(nextValue);
    this.valueChange.emit(nextValue);
  }

  toggleType(): void {
    this.type.update((type) => (type === 'password' ? 'text' : 'password'));
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
