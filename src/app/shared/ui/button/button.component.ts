import { Component, Input, booleanAttribute } from '@angular/core';
import { NgClass } from '@angular/common';

import {
  Color,
  Size,
  Variant,
  LOADING_CLASSES,
  outlineColors,
  sizes,
  solidColors,
} from '../../../config/classes';

@Component({
    selector: 'app-button',
    imports: [NgClass],
    template: `
    <button
      class="flex w-full items-center justify-center gap-2 rounded-lg border focus:outline-none focus:ring-offset-4 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-black md:focus:ring-2"
      [type]="type"
      [ngClass]="classes"
      [disabled]="loading || disabled"
    >
      <ng-content />
    </button>
  `
})
export class ButtonComponent {
  @Input({
    required: false,
  })
  type: 'button' | 'submit' | 'reset' = 'button';

  @Input({
    required: false,
  })
  size: Size = 'md';

  @Input({
    required: false,
  })
  variant: Variant = 'solid';

  @Input({
    required: false,
  })
  color: Color = 'default';

  @Input({
    required: false,
    transform: booleanAttribute,
  })
  loading = false;

  @Input({
    required: false,
    transform: booleanAttribute,
  })
  disabled = false;

  sizes = sizes;
  solidColors = solidColors;
  outlineColors = outlineColors;

  get classes(): string[] {
    const classes: string[] = [this.sizes[this.size]];

    if (this.loading) {
      classes.push(LOADING_CLASSES);
    }

    if (this.variant === 'solid') {
      classes.push(this.solidColors[this.color]);
    }

    if (this.variant === 'outline') {
      classes.push(this.outlineColors[this.color]);
    }

    return classes;
  }
}
