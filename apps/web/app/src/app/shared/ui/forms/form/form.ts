import { booleanAttribute, Component, input, model, output } from '@angular/core';
import { FormRoot, type FieldTree } from '@angular/forms/signals';

@Component({
  host: {
    class: /* tw */ 'block',
    '[attr.data-submitted]': 'submitted() ? "" : null',
  },
  imports: [FormRoot],
  selector: 'app-form',
  templateUrl: './form.html',
  styleUrl: './form.css',
})
export class Form {
  readonly form = input.required<FieldTree<unknown>>();
  readonly submitted = model(false);
  readonly novalidate = input(true, { transform: booleanAttribute });
  readonly ngSubmit = output<void>();

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    this.ngSubmit.emit();
  }
}
