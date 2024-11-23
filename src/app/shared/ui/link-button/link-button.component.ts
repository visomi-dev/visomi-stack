import { Component, booleanAttribute, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';

import {
  Color,
  Size,
  Variant,
  LOADING_CLASSES,
  outlineColors,
  sizes,
  solidColors,
} from '~/app/config/classes';

@Component({
  selector: 'app-link-button',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './link-button.component.html',
})
export class LinkButtonComponent {
  readonly sizes = sizes;
  readonly solidColors = solidColors;
  readonly outlineColors = outlineColors;

  readonly to = input.required<string | string[]>();
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

    switch (this.variant()) {
      case 'solid':
        classes.push(this.solidColors[this.color()]);
        break;
      case 'outline':
        classes.push(this.outlineColors[this.color()]);
        break;
      default:
        break;
    }

    return classes.join(' ');
  });
}
