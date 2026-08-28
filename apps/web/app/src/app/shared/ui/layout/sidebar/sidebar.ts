import { Component, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { uiClass } from '../../classes';

@Component({
  host: { class: /* tw */ 'flex h-full flex-col gap-4 p-4' },
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {}

@Component({
  host: { class: /* tw */ 'grid gap-1' },
  selector: 'app-sidebar-section',
  templateUrl: './sidebar-section.html',
  styleUrl: './sidebar.css',
})
export class SidebarSection {}

@Component({
  host: { class: /* tw */ 'block' },
  selector: 'app-sidebar-heading',
  templateUrl: './sidebar-heading.html',
  styleUrl: './sidebar.css',
})
export class SidebarHeading {}

@Component({
  host: { class: /* tw */ 'my-2 h-px bg-slate-950/10 dark:bg-white/10/50' },
  selector: 'app-sidebar-divider',
  templateUrl: './sidebar-divider.html',
  styleUrl: './sidebar.css',
})
export class SidebarDivider {}

@Component({
  host: { class: /* tw */ 'min-h-4 flex-1' },
  selector: 'app-sidebar-spacer',
  templateUrl: './sidebar-spacer.html',
  styleUrl: './sidebar.css',
})
export class SidebarSpacer {}

@Component({
  host: { class: /* tw */ 'block' },
  imports: [RouterLink, RouterLinkActive],
  selector: 'app-sidebar-item',
  templateUrl: './sidebar-item.html',
  styleUrl: './sidebar.css',
})
export class SidebarItem {
  readonly href = input<string | null>(null);
  readonly routerLink = input<unknown[] | string | null>(null);

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 transition hover:bg-slate-50 dark:bg-slate-900 hover:text-slate-950 dark:text-slate-50 [&_[data-slot=icon]]:size-5',
    ),
  );
}
