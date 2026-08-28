import { Component, computed, input, type Signal } from '@angular/core';

import { uiClass } from '../../classes';

export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

const STRENGTH_LABELS: Readonly<Record<PasswordStrengthLevel, string>> = Object.freeze({
  0: '—',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Excellent',
});

export function computePasswordStrength(value: string): PasswordStrengthLevel {
  if (!value) return 0;

  let score = 0;

  if (value.length >= 8) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  return Math.min(score, 4) as PasswordStrengthLevel;
}

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-password-strength',
  templateUrl: './password-strength.html',
  styleUrl: './password-strength.css',
})
export class PasswordStrength {
  readonly password = input.required<Signal<string>>();
  readonly id = input<string>('password-strength');
  readonly describedBy = input<string | null>(null);

  readonly level = computed<PasswordStrengthLevel>(() => computePasswordStrength(this.password()()));
  readonly label = computed(() => STRENGTH_LABELS[this.level()]);
  readonly percent = computed(() => (this.level() / 4) * 100);

  readonly barClasses = (current: number) =>
    uiClass(
      'h-2 rounded-full transition-colors',
      current <= this.level() ? 'bg-emerald-500/70 dark:bg-emerald-400/70' : 'bg-slate-100 dark:bg-slate-800',
    );

  readonly containerClasses = computed(() => 'space-y-1.5');
  readonly labelClasses = computed(() =>
    uiClass(
      'text-slate-500 dark:text-slate-400 block text-xs font-medium tracking-wide',
      this.level() === 0 ? 'opacity-0' : 'opacity-100',
    ),
  );
}
