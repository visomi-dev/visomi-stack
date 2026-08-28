import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type HeadingLevel = '1' | '2' | '3' | '4';

const headingSizes = Object.freeze({
  '1': /* tw */ 'text-4xl md:text-5xl',
  '2': /* tw */ 'text-3xl md:text-4xl',
  '3': /* tw */ 'text-2xl md:text-3xl',
  '4': /* tw */ 'text-xl md:text-2xl',
});

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-heading',
  templateUrl: './heading.html',
  styleUrl: './heading.css',
})
export class Heading {
  readonly text = input.required<string>();
  readonly level = input<HeadingLevel>('2');

  readonly classes = computed(() =>
    uiClass(
      'font-heading font-bold tracking-tight text-slate-950 dark:text-slate-50 text-balance',
      headingSizes[this.level()],
    ),
  );
}
