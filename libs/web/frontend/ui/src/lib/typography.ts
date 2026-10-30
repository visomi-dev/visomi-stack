export type TextSize = 'sm' | 'md' | 'lg';
export type TextTone = 'default' | 'muted';
export type HeadingSize = TextSize | 'xl';

const textSizes = { sm: 'text-sm leading-6', md: 'text-base leading-7', lg: 'text-lg leading-8' } as const;
const textTones = { default: 'text-zinc-950 dark:text-zinc-50', muted: 'text-zinc-600 dark:text-zinc-400' } as const;
const headingSizes = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl sm:text-3xl', xl: 'text-4xl sm:text-5xl' } as const;

export const heading = {
  classes({ size = 'lg' }: { size?: HeadingSize } = {}): string {
    return [
      'font-heading font-semibold tracking-tight text-balance text-zinc-950 dark:text-zinc-50',
      headingSizes[size],
    ].join(' ');
  },
} as const;

export const text = {
  classes({ size = 'md', tone = 'default' }: { size?: TextSize; tone?: TextTone } = {}): string {
    return ['text-pretty', textSizes[size], textTones[tone]].join(' ');
  },
} as const;

export const link = {
  classes(): string {
    return 'ui-focus-ring rounded-sm text-blue-700 underline underline-offset-4 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300';
  },
} as const;

export const divider = {
  classes({ soft = false }: { soft?: boolean } = {}): string {
    return [
      'w-full border-t',
      soft ? 'border-zinc-100 dark:border-zinc-800' : 'border-zinc-200 dark:border-zinc-700',
    ].join(' ');
  },
} as const;

export const code = {
  classes({ block = false }: { block?: boolean } = {}): string {
    return [
      'rounded-lg border border-zinc-200 bg-zinc-50 font-mono text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
      block ? 'block overflow-x-auto p-4 whitespace-pre' : 'px-1.5 py-0.5',
    ].join(' ');
  },
} as const;
