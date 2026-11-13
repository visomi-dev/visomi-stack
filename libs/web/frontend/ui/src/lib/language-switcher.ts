export const languageSwitcher = {
  classes(): string {
    return 'grid grid-cols-2 gap-0.5 rounded-lg border border-zinc-300 bg-zinc-100 p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  },
  optionClasses(current: boolean): string {
    return [
      'inline-flex min-h-11 w-full items-center justify-center rounded-md px-1 whitespace-nowrap sm:px-2.5',
      current
        ? 'bg-white font-semibold text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
        : 'ui-focus-ring font-medium text-zinc-600 no-underline hover:bg-white hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
    ].join(' ');
  },
} as const;
