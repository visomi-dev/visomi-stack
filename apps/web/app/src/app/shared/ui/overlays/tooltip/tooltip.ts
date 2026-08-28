import { Component, computed, input, signal } from '@angular/core';

import { uiClass } from '../../classes';

type TooltipPosition = 'bottom' | 'top';

@Component({
  host: {
    class: /* tw */ 'relative inline-flex items-center justify-center',
  },
  selector: 'app-tooltip',
  templateUrl: './tooltip.html',
  styleUrl: './tooltip.css',
})
export class Tooltip {
  readonly position = input<TooltipPosition>('top');
  readonly text = input.required<string>();

  readonly active = signal(false);
  readonly panelClasses = computed(() =>
    uiClass(
      'absolute z-30 w-52 rounded-[var(--radius-panel)] bg-slate-100 dark:bg-slate-800 p-3 text-sm font-normal text-slate-950 dark:text-slate-50 shadow-panel after:absolute after:left-1/2 after:-translate-x-1/2 after:border-x-8 after:border-x-transparent',
      this.position() === 'top' &&
        'bottom-[calc(100%+0.5rem)] after:top-full after:border-t-8 after:border-t-panel-raised',
      this.position() === 'bottom' &&
        'top-[calc(100%+0.5rem)] after:bottom-full after:border-b-8 after:border-b-panel-raised',
    ),
  );

  toggle(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.active.update((active) => !active);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      this.toggle(event);
    }

    if (event.key === 'Escape') {
      this.active.set(false);
    }
  }
}
