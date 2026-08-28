import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type AuthCardTone = 'panel' | 'raised';

@Component({
  host: {
    class: /* tw */ 'block w-full',
  },
  selector: 'app-auth-card',
  templateUrl: './auth-card.html',
  styleUrl: './auth-card.css',
})
export class AuthCard {
  readonly cardId = input<string | null>(null);
  readonly tone = input<AuthCardTone>('panel');

  readonly classes = computed(() =>
    uiClass(
      'mx-auto w-full max-w-[27.5rem] rounded-[var(--radius-panel)] border border-slate-950/10 dark:border-white/10 px-6 py-6 shadow-sm sm:px-8 sm:py-8 md:px-10 md:py-10',
      this.tone() === 'raised' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-900',
    ),
  );
}
