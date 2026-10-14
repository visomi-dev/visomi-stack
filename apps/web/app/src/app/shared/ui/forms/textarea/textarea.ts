import {
  afterRenderEffect,
  booleanAttribute,
  Component,
  computed,
  ElementRef,
  input,
  numberAttribute,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

@Component({
  host: { class: /* tw */ 'block' },
  selector: 'app-textarea',
  templateUrl: './textarea.html',
  styleUrl: './textarea.css',
})
export class Textarea {
  readonly ariaDescribedBy = input<string | null>(null);
  readonly controlId = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly maxLength = input<string | number | null>(null, { transform: numberAttribute });
  readonly minLength = input<string | number | null>(null, { transform: numberAttribute });
  readonly name = input<string | null>(null);
  readonly pattern = input<string | null>(null);
  readonly placeholder = input('');
  readonly required = input(false, { transform: booleanAttribute });
  readonly rows = input(4);
  readonly valueChange = output<string>();

  private readonly renderedValue = signal<string | null>(null);

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring min-h-28 w-full resize-y rounded-[var(--radius-control)] border bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-950 dark:text-slate-50 placeholder:text-slate-500 dark:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
      'border-[color:var(--color-border)] focus-visible:border-slate-600 dark:border-slate-500',
    ),
  );

  readonly formField = input.required<Field<string>>();

  protected readonly ready = computed(() => this.renderedValue() === this.formField()().value());

  private readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('textareaEl');

  focus(): boolean {
    const ref = this.textareaRef();

    if (!this.ready() || this.disabled() || this.formField()().disabled() || !ref) {
      return false;
    }

    ref.nativeElement.focus();

    return ref.nativeElement.ownerDocument.activeElement === ref.nativeElement;
  }

  onInput(event: Event): void {
    const nextValue = (event.target as HTMLTextAreaElement).value;

    this.renderedValue.set(nextValue);
    this.formField()().value.set(nextValue);
    this.formField()().markAsDirty();
    this.valueChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }

  private readonly syncTextareaAfterRender = afterRenderEffect({
    write: () => {
      const ref = this.textareaRef();
      const value = this.formField()().value() ?? '';

      if (ref) {
        if (ref.nativeElement.value !== value) {
          ref.nativeElement.value = value;
        }

        this.renderedValue.set(value);
      }
    },
  });
}
