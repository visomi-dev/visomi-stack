import { container } from './layout';

export type ShellLayout = 'sidebar' | 'stacked';
export type NavigationPlacement = 'sidebar' | 'navbar';

export const appShell = {
  classes(): string {
    return 'block min-h-dvh bg-white pb-[calc(6rem+env(safe-area-inset-bottom))] text-zinc-950 lg:pb-0 dark:bg-zinc-950 dark:text-zinc-50 [&_:focus]:scroll-mb-28 [&_:target]:scroll-mt-24';
  },
  frameClasses({ layout = 'sidebar' }: { layout?: ShellLayout } = {}): string {
    return layout === 'sidebar' ? 'min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]' : 'min-h-dvh';
  },
  sidebarClasses({ layout = 'sidebar' }: { layout?: ShellLayout } = {}): string {
    return layout === 'sidebar' ? 'hidden lg:sticky lg:top-0 lg:block lg:h-dvh lg:min-h-0' : 'hidden';
  },
  contentClasses(): string {
    return [
      container.classes({ width: 'xl', gutter: 'compact' }),
      'scroll-mt-24 py-8 focus:outline-none sm:py-12',
    ].join(' ');
  },
  headerClasses(): string {
    return 'lg:sticky lg:top-0 lg:z-30';
  },
  mobileClasses(): string {
    return 'fixed inset-x-0 bottom-0 z-40 lg:hidden';
  },
  skipClasses(): string {
    return 'ui-focus-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4 focus:text-zinc-950';
  },
} as const;

export const sidebar = {
  classes(): string {
    return 'flex h-full min-h-0 flex-col gap-6 border-r border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900';
  },
  navigationClasses(): string {
    return 'min-h-0 flex-1 space-y-6 overflow-y-auto p-1 -m-1';
  },
} as const;

export const topbar = {
  classes(): string {
    return 'flex min-h-18 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3 sm:px-8 dark:border-zinc-800 dark:bg-zinc-950';
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
  classes({ placement = 'sidebar' }: { placement?: NavigationPlacement } = {}): string {
    return [
      'ui-focus-ring relative flex min-h-11 min-w-11 cursor-pointer items-center rounded-lg text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200/60 hover:text-zinc-950 aria-[current=page]:bg-blue-50 aria-[current=page]:font-semibold aria-[current=page]:text-blue-700 aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:aria-[current=page]:bg-blue-950 dark:aria-[current=page]:text-blue-300 dark:aria-[current=page]:ring-blue-400/40 [&_[data-slot=icon]]:size-5 [&_[data-slot=icon]]:shrink-0',
      placement === 'navbar'
        ? 'min-w-0 flex-1 flex-col justify-center gap-1 px-1 py-2 text-center text-xs'
        : 'w-full gap-3 px-3 py-2',
    ].join(' ');
  },
} as const;
