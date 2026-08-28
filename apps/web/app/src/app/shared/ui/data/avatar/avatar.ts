import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type AvatarSize = 'sm' | 'md' | 'lg';

const avatarSizes = Object.freeze({
  sm: /* tw */ 'size-8 text-xs',
  md: /* tw */ 'size-10 text-sm',
  lg: /* tw */ 'size-14 text-base',
});

@Component({
  host: { class: /* tw */ 'inline-flex' },
  selector: 'app-avatar',
  templateUrl: './avatar.html',
  styleUrl: './avatar.css',
})
export class Avatar {
  readonly alt = input('');
  readonly initials = input('');
  readonly size = input<AvatarSize>('md');
  readonly src = input<string | null>(null);

  readonly classes = computed(() =>
    uiClass(
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 font-semibold text-slate-500 dark:text-slate-400',
      avatarSizes[this.size()],
    ),
  );
}
