import { Component, Input, signal } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [NgClass],
  template: `
    <div
      class="relative flex cursor-pointer flex-col items-center justify-center"
      tabindex="0"
      (keypress)="toggle()"
      (click)="toggle($event)"
    >
      <ng-content />

      <p
        class="absolute w-52 rounded-md border border-black bg-white p-4 text-base font-normal after:absolute after:left-1/2 after:-translate-x-1/2 after:border-l-8 after:border-r-8 after:border-transparent dark:border-white dark:bg-black"
        [ngClass]="{
          block: active(),
          hidden: !active(),
          'bottom-[calc(100%+0.5rem)] after:top-full after:border-t-8 after:border-t-black dark:after:border-t-white':
            position === 'top',
          'top-[calc(100%+0.5rem)] after:bottom-full after:border-b-8 after:border-b-black dark:after:border-b-white':
            position === 'bottom',
        }"
      >
        {{ text }}
      </p>
    </div>
  `,
  styles: ``,
})
export class TooltipComponent {
  @Input({
    required: true,
  })
  text!: string;

  @Input()
  position: 'top' | 'bottom' = 'top';

  readonly active = signal(false);

  toggle(event?: MouseEvent) {
    this.active.update((active) => !active);

    if (event != null) {
      event.stopPropagation();
      event.preventDefault();
    }
  }
}
