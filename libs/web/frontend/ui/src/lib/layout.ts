export type SurfaceTone = 'default' | 'raised' | 'ghost' | 'subtle' | 'accent' | 'inverse';
export type Padding = 'none' | 'sm' | 'md' | 'lg';
export type CardLayout = 'stack' | 'plain';
export type ContainerWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ContainerGutter = 'default' | 'compact' | 'none';

const paddings = { none: '', sm: 'p-3 sm:p-4', md: 'p-4 sm:p-6', lg: 'p-6 sm:p-8' } as const;
const surfaces = {
  default: 'border-zinc-200 bg-white text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50',
  raised:
    'border-zinc-200 bg-zinc-50 text-zinc-950 shadow-xl shadow-zinc-950/5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50',
  ghost: 'border-transparent bg-transparent text-zinc-950 dark:text-zinc-50',
  subtle: 'border-zinc-200 bg-zinc-50 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-50',
  accent: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  inverse: 'border-zinc-700 bg-zinc-950 text-zinc-100',
} as const;
const widths = { sm: 'max-w-lg', md: 'max-w-3xl', lg: 'max-w-6xl', xl: 'max-w-7xl', full: 'max-w-none' } as const;
const gutters = { default: 'px-6 sm:px-10', compact: 'px-5 sm:px-8', none: '' } as const;

export const container = {
  classes({ width = 'lg', gutter = 'default' }: { width?: ContainerWidth; gutter?: ContainerGutter } = {}): string {
    return ['mx-auto w-full min-w-0', gutters[gutter], widths[width]].filter(Boolean).join(' ');
  },
} as const;

export const card = {
  classes({
    tone = 'default',
    padding = 'md',
    layout = 'stack',
  }: { tone?: SurfaceTone; padding?: Padding; layout?: CardLayout } = {}): string {
    return [
      'min-w-0 rounded-xl border',
      layout === 'stack' ? 'flex flex-col gap-4' : '',
      surfaces[tone],
      paddings[padding],
    ]
      .filter(Boolean)
      .join(' ');
  },
} as const;

export const pageHeader = {
  classes(): string {
    return 'flex flex-wrap items-start justify-between gap-5 border-b border-zinc-200 pb-6 dark:border-zinc-700';
  },
} as const;
