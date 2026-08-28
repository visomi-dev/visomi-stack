import { Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { uiClass } from '../../classes';

@Component({
  host: {
    class:
      /* tw */ 'block border-t border-slate-950/10 dark:border-white/10 bg-white dark:bg-slate-950/95 backdrop-blur md:hidden',
  },
  selector: 'app-bottom-navigation',
  templateUrl: './bottom-navigation.html',
  styleUrl: './bottom-navigation.css',
})
export class BottomNavigation {}

@Component({
  host: {
    class: /* tw */ 'flex min-w-0 flex-1 items-center justify-center',
  },
  imports: [RouterLink, RouterLinkActive],
  selector: 'app-bottom-navigation-item',
  templateUrl: './bottom-navigation-item.html',
  styleUrl: './bottom-navigation.css',
})
export class BottomNavigationItem {
  readonly ariaLabel = input.required<string>();
  readonly routerLink = input.required<unknown[] | string>();
  readonly exact = input(true);

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-control)] p-2 text-slate-500 dark:text-slate-400 transition aria-[current=page]:bg-slate-100 aria-[current=page]:text-slate-600 aria-[current=page]:dark:bg-slate-800 aria-[current=page]:dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 hover:text-slate-950 dark:text-slate-50 [&_[data-slot=icon]]:size-6',
    ),
  );
}

@Component({
  host: {
    class: /* tw */ 'flex min-w-0 flex-1 items-center justify-center',
  },
  selector: 'app-bottom-navigation-action',
  templateUrl: './bottom-navigation-action.html',
  styleUrl: './bottom-navigation.css',
})
export class BottomNavigationAction {
  readonly ariaLabel = input.required<string>();
  readonly pressed = output<void>();

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-control)] p-2 text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:bg-slate-800 hover:text-slate-950 dark:text-slate-50 [&_[data-slot=icon]]:size-6',
    ),
  );
}
