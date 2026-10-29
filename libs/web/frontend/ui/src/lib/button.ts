const base =
  'ui-focus-ring inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-lg border font-medium disabled:cursor-not-allowed disabled:opacity-50';

const variants = {
  primary: 'border-blue-600 bg-blue-600 text-white enabled:hover:bg-blue-700 enabled:active:bg-blue-800',
  secondary:
    'border-zinc-500 bg-white text-zinc-950 enabled:hover:bg-zinc-100 enabled:active:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:enabled:hover:bg-zinc-800 dark:enabled:active:bg-zinc-700',
} as const;

const sizes = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2.5 text-base',
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
