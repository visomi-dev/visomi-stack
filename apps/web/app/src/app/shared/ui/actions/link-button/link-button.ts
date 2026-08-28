import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { uiClass } from '../../classes';

type LinkButtonVariant = 'solid' | 'outline' | 'plain';
type LinkButtonTone = 'slate' | 'blue' | 'red' | 'green' | 'amber';
type LinkButtonSize = 'sm' | 'md' | 'lg';

const toneAliases: Record<string, LinkButtonTone> = {
  default: 'slate',
  accent: 'blue',
  danger: 'red',
  success: 'green',
  warning: 'amber',
};

const linkButtonBase =
  /* tw */ 'ui-focus-ring relative isolate inline-flex items-center justify-center gap-x-2 rounded-[var(--radius-control)] font-semibold transition [&_[data-slot=icon]]:size-5';

const linkButtonSolid = /* tw */ [
  'border-transparent shadow-sm',
  'bg-(--btn-border) before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-control)-1px)] before:bg-(--btn-bg) before:shadow-sm',
  'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-control)-1px)] after:shadow-[inset_0_1px_rgb(255_255_255/0.15)]',
  'data-[hover]:after:bg-(--btn-hover-overlay) data-[active]:after:bg-(--btn-hover-overlay) hover:after:bg-(--btn-hover-overlay) active:after:bg-(--btn-hover-overlay)',
].join(' ');

const linkButtonOutline = /* tw */ 'border border-slate-950/10 dark:border-white/10 bg-transparent';
const linkButtonPlain = /* tw */ 'bg-transparent shadow-none';

const linkButtonTones = Object.freeze({
  slate:
    /* tw */ '[--btn-bg:var(--color-slate-100)] [--btn-border:var(--color-slate-200)] [--btn-fg:var(--color-slate-950)] [--btn-hover-overlay:rgb(9_9_11/0.06)] text-slate-950 dark:[--btn-bg:var(--color-slate-800)] dark:[--btn-border:var(--color-slate-700)] dark:[--btn-fg:var(--color-slate-50)] dark:[--btn-hover-overlay:rgb(255_255_255/0.05)] dark:text-slate-50',
  blue: /* tw */ '[--btn-bg:var(--color-slate-600)] [--btn-border:var(--color-slate-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  red: /* tw */ '[--btn-bg:var(--color-red-600)] [--btn-border:var(--color-red-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  green:
    /* tw */ '[--btn-bg:var(--color-green-600)] [--btn-border:var(--color-green-700)] [--btn-fg:#ffffff] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-white',
  amber:
    /* tw */ '[--btn-bg:var(--color-amber-500)] [--btn-border:var(--color-amber-600)] [--btn-fg:var(--color-slate-950)] [--btn-hover-overlay:rgb(255_255_255/0.12)] text-slate-950',
});

const linkButtonSizes = Object.freeze({
  sm: /* tw */ 'min-h-9 px-3 py-1.5 text-sm',
  md: /* tw */ 'min-h-11 px-4 py-2 text-sm',
  lg: /* tw */ 'min-h-12 px-5 py-2.5 text-base',
});

function resolveTone(value: string): LinkButtonTone {
  return toneAliases[value] ?? (value as LinkButtonTone);
}

@Component({
  host: {
    class: /* tw */ 'inline-block',
  },
  imports: [RouterLink],
  selector: 'app-link-button',
  templateUrl: './link-button.html',
  styleUrl: './link-button.css',
})
export class LinkButton {
  readonly ariaLabel = input<string | null>(null);
  readonly href = input<string | null>(null);
  readonly routerLink = input<unknown[] | string | null>(null);
  readonly size = input<LinkButtonSize>('md');
  readonly target = input<string | null>(null);
  readonly text = input.required<string>();
  readonly tone = input<string>('blue');
  readonly variant = input<LinkButtonVariant>('solid');

  readonly classes = computed(() => {
    const variant = this.variant();
    const tone = resolveTone(this.tone());

    if (variant === 'solid') {
      return uiClass(linkButtonBase, linkButtonSolid, linkButtonTones[tone], linkButtonSizes[this.size()]);
    }

    if (variant === 'outline') {
      return uiClass(linkButtonBase, linkButtonOutline, linkButtonTones[tone], linkButtonSizes[this.size()]);
    }

    return uiClass(linkButtonBase, linkButtonPlain, linkButtonTones[tone], linkButtonSizes[this.size()]);
  });
}
