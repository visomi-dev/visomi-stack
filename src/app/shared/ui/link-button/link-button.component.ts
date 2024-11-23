import { Component, Input, booleanAttribute } from '@angular/core';
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
} from '../../../config/classes';

@Component({
  selector: 'app-link-button',
  standalone: true,
  imports: [NgClass, RouterLink],
  template: `
    <a
      [routerLink]="to"
      class="flex w-full items-center justify-center gap-2 rounded-lg border-2 focus:outline-none focus:ring-offset-4 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-black md:focus:ring-2"
      [ngClass]="classes"
    >
      <ng-content />
    </a>
  `,
  styles: [],
})
export class LinkButtonComponent {
  @Input({ required: true }) to!: string | string[];

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
