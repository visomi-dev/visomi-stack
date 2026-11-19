import { container } from './layout';

export type ShellLayout = 'sidebar' | 'stacked';
export type NavigationPlacement = 'sidebar' | 'navbar';

export const appShell = {
  classes({ inset = false, compact = false } = {}): string {
    return [
      'flex h-dvh min-h-0 flex-col overflow-hidden bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50',
      inset ? 'lg:bg-zinc-50 lg:dark:bg-zinc-900' : '',
      compact ? '[--ui-shell-sidebar-width:4.5rem]' : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  frameClasses({ layout = 'sidebar' }: { layout?: ShellLayout } = {}): string {
    return layout === 'sidebar'
      ? 'min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[var(--ui-shell-sidebar-width,17rem)_minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-200 lg:motion-reduce:transition-none'
      : 'min-h-0 flex-1 overflow-hidden';
  },
  sidebarClasses({ layout = 'sidebar' }: { layout?: ShellLayout } = {}): string {
    return layout === 'sidebar' ? 'hidden min-h-0 lg:block' : 'hidden';
  },
  panelClasses(inset: boolean): string {
    return [
      'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
      inset
        ? 'lg:my-2 lg:me-2 lg:h-auto lg:rounded-2xl lg:border lg:border-zinc-200 lg:bg-white lg:shadow-sm lg:dark:border-zinc-800 lg:dark:bg-zinc-950'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  scrollClasses(): string {
    return 'relative min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain focus:outline-none [&_:focus]:scroll-my-4 [&_:target]:scroll-mt-4';
  },
  contentClasses(): string {
    return [container.classes({ width: 'xl', gutter: 'compact' }), 'py-8 sm:py-12'].join(' ');
  },
  headerClasses(): string {
    return 'z-30 shrink-0';
  },
  mobileClasses(): string {
    return 'z-40 shrink-0 lg:hidden';
  },
  skipClasses(): string {
    return 'ui-focus-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4 focus:text-zinc-950';
  },
} as const;

export const sidebar = {
  classes({ inset = false } = {}): string {
    return [
      'flex h-full min-h-0 flex-col gap-6 border-r border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900',
      inset ? 'lg:gap-4 lg:border-r-0 lg:p-3' : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  navigationClasses(): string {
    return 'min-h-0 flex-1 space-y-6 overflow-y-auto p-1 -m-1';
  },
} as const;

export const topbar = {
  classes({ compact = false } = {}): string {
    return [
      'flex min-h-18 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3 sm:px-8 dark:border-zinc-800 dark:bg-zinc-950',
      compact ? 'lg:min-h-14 lg:gap-2 lg:px-4 lg:py-2' : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  titleClasses(): string {
    return 'flex min-w-0 items-center gap-3 font-heading font-semibold';
  },
  actionsClasses(): string {
    return 'flex min-w-0 flex-wrap items-center gap-3';
  },
} as const;

export const navbar = {
  classes(): string {
    return 'flex items-stretch gap-1 border-t border-zinc-200 bg-white px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-zinc-800 dark:bg-zinc-950';
  },
} as const;

export const navItem = {
  classes({
    placement = 'sidebar',
    compact = false,
  }: { placement?: NavigationPlacement; compact?: boolean } = {}): string {
    return [
      'ui-focus-ring relative flex min-h-11 min-w-11 cursor-pointer items-center rounded-lg text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200/60 hover:text-zinc-950 aria-[current=page]:bg-blue-50 aria-[current=page]:font-semibold aria-[current=page]:text-blue-700 aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:aria-[current=page]:bg-blue-950 dark:aria-[current=page]:text-blue-300 dark:aria-[current=page]:ring-blue-400/40 [&_[data-slot=icon]]:size-5 [&_[data-slot=icon]]:shrink-0',
      placement === 'navbar'
        ? 'min-w-0 flex-1 flex-col justify-center gap-1 px-1 py-2 text-center text-xs'
        : 'w-full gap-3 px-3 py-2',
      compact ? 'justify-center [&_[data-slot=label]]:sr-only' : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
} as const;
