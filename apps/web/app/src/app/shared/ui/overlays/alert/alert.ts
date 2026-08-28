import { Component, computed, input } from '@angular/core';

import { type IconName } from '../../media/icon/icon-paths';
import { Icon } from '../../media/icon/icon';
import { uiClass } from '../../classes';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
type AlertVariant = 'default' | 'auth';

const alertTones = Object.freeze({
  auth: {
    danger:
      /* tw */ 'border-red-600/20 dark:border-red-500/20 bg-red-600/5 dark:bg-red-500/10 text-red-800 dark:text-red-300',
    info: /* tw */ 'border-slate-600 dark:border-slate-500/20 bg-slate-600 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400',
    success:
      /* tw */ 'border-green-600/20 dark:border-green-500/20 bg-green-600/5 dark:bg-green-500/10 text-green-600 dark:text-green-400',
    warning: /* tw */ 'border-warning/20 bg-warning/10 text-warning',
  },
  default: {
    danger:
      /* tw */ 'border-red-600/20 dark:border-red-500/20 bg-red-600/5 dark:bg-red-500/10 text-red-800 dark:text-red-300',
    info: /* tw */ 'border-slate-600 dark:border-slate-500/20 bg-slate-600/5 dark:bg-slate-500/10 text-slate-950 dark:text-slate-50',
    success:
      /* tw */ 'border-green-600/20 dark:border-green-500/20 bg-green-600/5 dark:bg-green-500/10 text-slate-950 dark:text-slate-50',
    warning:
      /* tw */ 'border-amber-600/20 dark:border-amber-500/20 bg-amber-600/5 dark:bg-amber-500/10 text-slate-950 dark:text-slate-50',
  },
});

const alertIcons = Object.freeze({
  danger: 'circle-alert',
  info: 'circle-info',
  success: 'circle-check',
  warning: 'circle-alert',
} satisfies Record<AlertTone, IconName>);

@Component({
  host: { class: /* tw */ 'block' },
  imports: [Icon],
  selector: 'app-alert',
  templateUrl: './alert.html',
  styleUrl: './alert.css',
})
export class Alert {
  readonly tone = input<AlertTone>('info');
  readonly variant = input<AlertVariant>('auth');

  readonly classes = computed(() => {
    const tone = this.tone();
    const variant = this.variant();
    const base =
      variant === 'auth'
        ? 'rounded-[var(--radius-control)] border px-3.5 py-2.5 text-sm font-medium'
        : 'rounded-[var(--radius-panel)] border p-4 text-sm';

    return uiClass(base, alertTones[variant][tone]);
  });

  readonly iconName = computed(() => alertIcons[this.tone()]);
  readonly role = computed(() => (this.tone() === 'danger' ? 'alert' : 'status'));
  readonly showIcon = computed(() => this.variant() === 'auth');
}
