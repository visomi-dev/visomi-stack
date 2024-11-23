import { Component, booleanAttribute, computed, input } from '@angular/core';
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
  templateUrl: './button.component.html',
})
export class ButtonComponent {
  sizes = sizes;
  solidColors = solidColors;
  outlineColors = outlineColors;

  readonly type = input<'button' | 'submit' | 'reset'>('button');

  readonly size = input<Size>('md');

  readonly variant = input<Variant>('solid');

  readonly color = input<Color>('default');

  readonly loading = input(false, { transform: booleanAttribute });

  readonly disabled = input(false, { transform: booleanAttribute });

  readonly classes = computed(() => {
    const classes: string[] = [this.sizes[this.size()]];

    if (this.loading()) {
      classes.push(LOADING_CLASSES);
    }

    const variant = this.variant();
    const color = this.color();
    if (variant === 'solid') {
      classes.push(this.solidColors[color]);
    }

    if (variant === 'outline') {
      classes.push(this.outlineColors[color]);
    }

    return classes;
  });
}
