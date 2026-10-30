export type SurfaceTone = 'default' | 'raised' | 'ghost';
export type Padding = 'sm' | 'md' | 'lg';
export type ContainerWidth = 'sm' | 'md' | 'lg' | 'full';

const paddings = { sm: 'p-3 sm:p-4', md: 'p-4 sm:p-6', lg: 'p-6 sm:p-8' } as const;
const surfaces = {
  default: 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900',
  raised: 'border-zinc-200 bg-zinc-50 shadow-xl shadow-zinc-950/5 dark:border-zinc-700 dark:bg-zinc-800',
  ghost: 'border-transparent bg-transparent',
} as const;
const widths = { sm: 'max-w-lg', md: 'max-w-3xl', lg: 'max-w-6xl', full: 'max-w-none' } as const;

export const container = {
  classes({ width = 'lg' }: { width?: ContainerWidth } = {}): string {
    return ['mx-auto w-full min-w-0 px-6 sm:px-10', widths[width]].join(' ');
  },
} as const;

export const card = {
  classes({ tone = 'default', padding = 'md' }: { tone?: SurfaceTone; padding?: Padding } = {}): string {
    return [
      'flex min-w-0 flex-col gap-4 rounded-xl border text-zinc-950 dark:text-zinc-50',
      surfaces[tone],
      paddings[padding],
    ].join(' ');
  },
} as const;

export const pageHeader = {
  classes(): string {
    return 'flex flex-wrap items-start justify-between gap-5 border-b border-zinc-200 pb-6 dark:border-zinc-700';
  },
} as const;
