import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type TextSize = 'sm' | 'md' | 'lg';
type TextTone = 'default' | 'muted' | 'danger' | 'accent';

const textSizes = Object.freeze({
  sm: /* tw */ 'text-sm',
  md: /* tw */ 'text-base',
  lg: /* tw */ 'text-lg',
});
const textTones = Object.freeze({
  default: /* tw */ 'text-slate-950 dark:text-slate-50',
  muted: /* tw */ 'text-slate-500 dark:text-slate-400',
  danger: /* tw */ 'text-red-600 dark:text-red-400',
  accent: /* tw */ 'text-accent',
});

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-text',
  templateUrl: './text.html',
  styleUrl: './text.css',
})
export class Text {
  readonly size = input<TextSize>('md');
  readonly tone = input<TextTone>('default');

  readonly classes = computed(() => uiClass('ui-text-rhythm', textSizes[this.size()], textTones[this.tone()]));
}
