import { booleanAttribute, Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type ButtonVariant = 'solid' | 'outline' | 'plain';
type ButtonTone = 'slate' | 'blue' | 'red' | 'green' | 'amber';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Tone aliases map the legacy Material 3 names to the Catalyst color names.
 * Deprecated tones still resolve to the same visual result so existing callers
 * do not have to migrate in lockstep with this PR.
 */
const toneAliases: Record<string, ButtonTone> = {
  default: 'slate',
  accent: 'blue',
  danger: 'red',
  success: 'green',
  warning: 'amber',
};

const buttonBase =
  /* tw */ 'ui-focus-ring ui-touch-target relative isolate inline-flex items-center justify-center text-center gap-x-2 rounded-[var(--radius-control)] font-semibold transition disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-wait [&_[data-slot=icon]]:size-5';

/**
 * Solid buttons follow the Catalyst optical-border pattern: the `background`
 * is the `--btn-border` color (one shade darker than the visible fill), the
 * `before` pseudo-element renders the actual button color, and the `after`
 * pseudo-element handles the inset highlight shadow plus the hover overlay.
 *
 * All tone-specific values come from the Tailwind v4 palette via
 * `var(--color-*)`. The Button does not depend on any custom semantic
 * tokens in styles.base.css.
 */
const buttonSolid = /* tw */ [
  'border-transparent shadow-sm',
  'bg-(--btn-border) before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-control)-1px)] before:bg-(--btn-bg) before:shadow-sm',
  'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-control)-1px)] after:shadow-[inset_0_1px_rgb(255_255_255/0.15)]',
  'data-[hover]:after:bg-(--btn-hover-overlay) data-[active]:after:bg-(--btn-hover-overlay) hover:after:bg-(--btn-hover-overlay) active:after:bg-(--btn-hover-overlay)',
  'disabled:before:shadow-none disabled:after:shadow-none',
].join(' ');

const buttonOutline = /* tw */ 'border border-slate-950/10 dark:border-white/10 bg-transparent';
const buttonPlain = /* tw */ 'bg-transparent shadow-none';

const buttonTones = Object.freeze({
  slate:
    /* tw */ '[--btn-bg:var(--color-slate-100)] [--btn-border:var(--color-slate-200)] [--btn-fg:var(--color-slate-950)] [--btn-hover-overlay:rgb(9_9_11/0.06)] text-slate-950 dark:[--btn-bg:var(--color-slate-800)] dark:[--btn-border:var(--color-slate-700)] dark:[--btn-fg:var(--color-slate-50)] dark:[--btn-hover-overlay:rgb(255_255_255/0.05)] dark:text-slate-50',
  blue: /* tw */ '[--btn-bg:var(--color-slate-600)] [--btn-border:var(--color-slate-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  red: /* tw */ '[--btn-bg:var(--color-red-600)] [--btn-border:var(--color-red-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  green:
    /* tw */ '[--btn-bg:var(--color-green-600)] [--btn-border:var(--color-green-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  amber:
    /* tw */ '[--btn-bg:var(--color-amber-500)] [--btn-border:var(--color-amber-600)] [--btn-fg:var(--color-slate-950)] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-slate-950',
});

const buttonSizes = Object.freeze({
  sm: /* tw */ 'min-h-9 px-3 py-1.5 text-sm',
  md: /* tw */ 'min-h-11 px-4 py-2 text-sm',
  lg: /* tw */ 'min-h-12 px-5 py-2.5 text-base',
});

@Component({
  host: {
    class: /* tw */ 'inline-block',
    '[class]': 'hostClass()',
  },
  selector: 'app-button',
  templateUrl: './button.html',
  styleUrl: './button.css',
})
export class Button {
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly fullWidth = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly size = input<ButtonSize>('md');
  readonly tone = input<string>('slate');
  readonly type = input<'button' | 'reset' | 'submit'>('button');
  readonly variant = input<ButtonVariant>('solid');

  readonly hostClass = computed(() => (this.fullWidth() ? 'block w-full' : 'inline-block'));

  readonly classes = computed(() => {
    const variant = this.variant();
    const tone = resolveTone(this.tone());
    const widthClass = this.fullWidth() ? 'w-full' : '';

    if (variant === 'solid') {
      return uiClass(buttonBase, buttonSolid, buttonTones[tone], buttonSizes[this.size()], widthClass);
    }

    if (variant === 'outline') {
      return uiClass(buttonBase, buttonOutline, buttonTones[tone], buttonSizes[this.size()], widthClass);
    }

    return uiClass(buttonBase, buttonPlain, buttonTones[tone], buttonSizes[this.size()], widthClass);
  });
}

function resolveTone(value: string): ButtonTone {
  return toneAliases[value] ?? (value as ButtonTone);
}
