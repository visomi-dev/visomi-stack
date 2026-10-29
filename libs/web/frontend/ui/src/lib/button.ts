const base =
  'ui-focus-ring inline-flex min-w-11 cursor-pointer items-center justify-center gap-2 rounded-lg border font-medium disabled:cursor-not-allowed disabled:opacity-50';

const variants = {
  primary: 'border-blue-600 bg-blue-600 text-white enabled:hover:bg-blue-700 enabled:active:bg-blue-800',
  secondary:
    'border-zinc-500 bg-white text-zinc-950 enabled:hover:bg-zinc-100 enabled:active:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:enabled:hover:bg-zinc-800 dark:enabled:active:bg-zinc-700',
  danger: 'border-red-700 bg-red-700 text-white enabled:hover:bg-red-800 enabled:active:bg-red-900',
  ghost:
    'border-transparent bg-transparent text-zinc-950 enabled:hover:bg-zinc-100 enabled:active:bg-zinc-200 dark:text-zinc-50 dark:enabled:hover:bg-zinc-800 dark:enabled:active:bg-zinc-700',
} as const;

const sizes = {
  sm: 'min-h-11 px-3 py-2 text-sm',
  md: 'min-h-11 px-4 py-2.5 text-base',
  lg: 'min-h-12 px-5 py-3 text-lg',
  icon: 'min-h-11 size-11 p-0 text-sm',
} as const;

const linkVariants = {
  primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
  secondary:
    'border-zinc-500 bg-white text-zinc-950 hover:bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700',
  danger: 'border-red-700 bg-red-700 text-white hover:bg-red-800 active:bg-red-900',
  ghost:
    'border-transparent bg-transparent text-zinc-950 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700',
} as const;

export const linkButton = {
  classes({ variant = 'primary', size = 'md' }: ButtonOptions = {}): string {
    return [
      base,
      linkVariants[variant],
      sizes[size],
      'no-underline aria-[current=page]:border-blue-600 aria-[current=page]:bg-blue-600 aria-[current=page]:text-white',
    ].join(' ');
  },
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;
export type ButtonOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const button = {
  classes({ variant = 'primary', size = 'md' }: ButtonOptions = {}): string {
    return [base, variants[variant], sizes[size]].join(' ');
  },
} as const;
