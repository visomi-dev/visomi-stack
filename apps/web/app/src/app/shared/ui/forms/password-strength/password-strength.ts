import { Component, computed, inject, input, resource, type Signal } from '@angular/core';

import { Deps } from '../../../deps';
import { uiClass } from '../../classes';

export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-password-strength',
  templateUrl: './password-strength.html',
  styleUrl: './password-strength.css',
})
export class PasswordStrength {
  private readonly deps = inject(Deps);
  readonly password = input.required<Signal<string>>();
  readonly id = input<string>('password-strength');
  readonly describedBy = input<string | null>(null);

  private readonly estimate = resource({
    params: () => this.password()().normalize('NFC'),
    loader: async ({ params, abortSignal }) => {
      if (!params) return null;
      const estimator = await this.deps.loadPasswordEstimator();

      if (abortSignal.aborted) return null;

      return estimator.check(params).score;
    },
  });
  readonly level = computed<PasswordStrengthLevel>(() => (this.estimate.hasValue() ? (this.estimate.value() ?? 0) : 0));
  readonly label = computed(() => {
    if (!this.password()()) return '—';
    if (this.estimate.error()) return $localize`:@@passwordEstimateUnavailable:Strength estimate unavailable.`;
    if (this.estimate.isLoading()) return $localize`:@@passwordEstimateLoading:Estimating strength…`;
    const labels = [
      $localize`:@@passwordStrengthVeryWeak:Very weak`,
      $localize`:@@passwordStrengthWeak:Weak`,
      $localize`:@@passwordStrengthFair:Fair`,
      $localize`:@@passwordStrengthStrong:Strong`,
      $localize`:@@passwordStrengthVeryStrong:Very strong`,
    ];

    return labels[this.level()];
  });
  readonly guidance = computed(() =>
    this.password()() && !this.estimate.isLoading() && !this.estimate.error() && this.level() < 3
      ? $localize`:@@passwordStrengthAdvice:Try several unrelated words. Avoid common phrases, sequences, and repeated characters.`
      : $localize`:@@passwordStrengthEstimateNote:Estimated resistance to guessing, not a guarantee.`,
  );
  readonly percent = computed(() => (this.level() / 4) * 100);

  readonly barClasses = (current: number) =>
    uiClass(
      'h-2 rounded-full transition-colors',
      current <= this.level() && this.password()()
        ? this.level() < 2
          ? 'bg-red-500 dark:bg-red-400'
          : this.level() === 2
            ? 'bg-amber-500 dark:bg-amber-400'
            : 'bg-emerald-500/70 dark:bg-emerald-400/70'
        : 'bg-slate-100 dark:bg-slate-800',
    );

  readonly containerClasses = computed(() => 'space-y-1.5');
  readonly labelClasses = computed(() =>
    uiClass(
      'text-slate-500 dark:text-slate-400 block text-xs font-medium tracking-wide pt-1',
      !this.password()() ? 'opacity-0' : 'opacity-100',
    ),
  );
}
