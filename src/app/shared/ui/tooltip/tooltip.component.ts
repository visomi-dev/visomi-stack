import { Component, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [NgClass],
  templateUrl: './tooltip.component.html',
})
export class TooltipComponent {
  readonly text = input.required<string>();
  readonly position = input<'top' | 'bottom'>('top');

  readonly active = signal(false);

  toggle(event?: MouseEvent) {
    this.active.update((active) => !active);

    if (event != null) {
      event.stopPropagation();
      event.preventDefault();
    }
  }
}
