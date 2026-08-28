import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type BadgeTone = 'default' | 'accent' | 'danger' | 'success' | 'warning';

const badgeTones = Object.freeze({
  default: /* tw */ 'bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-slate-50',
  accent: /* tw */ 'bg-slate-600/10 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400',
  danger: /* tw */ 'bg-red-600/10 dark:bg-red-500/20 text-red-600 dark:text-red-400',
  success: /* tw */ 'bg-green-600/10 dark:bg-green-500/20 text-green-600 dark:text-green-400',
  warning: /* tw */ 'bg-amber-600/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
});

@Component({
  host: { class: /* tw */ 'inline-flex' },
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.css',
})
export class Badge {
  readonly tone = input<BadgeTone>('default');

  readonly classes = computed(() =>
    uiClass('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', badgeTones[this.tone()]),
  );
}
