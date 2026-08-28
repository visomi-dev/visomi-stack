import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type LabelTone = 'plain' | 'mono-uppercase';

const labelTones = Object.freeze({
  plain: /* tw */ 'text-slate-950 dark:text-slate-50 text-sm font-semibold',
  'mono-uppercase':
    /* tw */ 'text-slate-500 dark:text-slate-400 font-mono text-xs font-semibold tracking-widest uppercase',
});

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-label',
  templateUrl: './label.html',
  styleUrl: './label.css',
})
export class Label {
  readonly for = input<string | null>(null);
  readonly tone = input<LabelTone>('mono-uppercase');

  readonly classes = computed(() => uiClass('block', labelTones[this.tone()]));
}
