import {
  afterNextRender,
  booleanAttribute,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';
import { FormRoot, type FieldTree } from '@angular/forms/signals';

@Component({
  host: {
    class: /* tw */ 'block',
    '[attr.data-submitted]': 'validationFeedback() ? "" : null',
  },
  imports: [FormRoot],
  selector: 'app-form',
  templateUrl: './form.html',
  styleUrl: './form.css',
})
export class Form {
  private readonly injector = inject(Injector);
  private readonly errorSummary = viewChild<ElementRef<HTMLElement>>('errorSummary');
  readonly form = input.required<FieldTree<unknown>>();
  readonly submitted = model(false);
  protected readonly validationFeedback = linkedSignal(() => this.submitted());
  readonly novalidate = input(true, { transform: booleanAttribute });
  readonly ngSubmit = output<void>();
  protected readonly messages = computed(() =>
    this.validationFeedback()
      ? [
          ...new Set(
            this.form()()
              .errorSummary()
              .map((error) => error.message ?? $localize`:@@formInvalidValue:Check the highlighted field.`),
          ),
        ]
      : [],
  );

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.form()().invalid()) {
      this.validationFeedback.set(true);
      this.form()().markAsTouched();
      afterNextRender(() => this.errorSummary()?.nativeElement.focus(), { injector: this.injector });

      return;
    }
    if (this.form()().pending() || this.form()().submitting()) return;
    this.validationFeedback.set(false);
    this.ngSubmit.emit();
  }
}
