import { Component, booleanAttribute, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../icon/icon.component';

@Component({
  selector: 'app-radio-card',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule, IconComponent],
  templateUrl: './radio-card.component.html',
})
export class RadioCardComponent {
  readonly form = input.required<FormGroup>();
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly value = input.required<string>();
  readonly label = input<string>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly readonly = input<boolean, unknown>(undefined, {
    transform: booleanAttribute,
  });
  readonly loading = input(false, { transform: booleanAttribute });

  readonly requiredAttr = computed(() => (this.required() ? true : undefined));
  readonly readonlyAttr = computed(() => (this.readonly() ? true : undefined));
  readonly checked = computed(
    () => this.form().get(this.name())?.value === this.value(),
  );
  readonly inputClasses = computed(() =>
    this.checked() ? 'border-primary' : 'border-black dark:border-white',
  );

  onKeyUp(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    this.onSelect();
  }

  onSelect(event?: MouseEvent) {
    if (event) {
      event.preventDefault();
    }

    const control = this.form().get(this.name());

    if (!control) {
      return;
    }

    const value = control.value;

    if (value === this.value()) {
      control.setValue('');
    } else {
      control.setValue(this.value());
    }
  }
}
