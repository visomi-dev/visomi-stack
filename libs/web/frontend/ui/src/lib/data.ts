export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type TableDensity = 'comfortable' | 'compact';

export const toneClasses = {
  neutral: 'border-zinc-200 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  accent: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  danger: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
} as const;
const avatarSizes = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const;

export const badge = {
  classes({ tone = 'neutral' }: { tone?: Tone } = {}): string {
    return [
      'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium break-words',
      toneClasses[tone],
    ].join(' ');
  },
} as const;

export const avatar = {
  classes({ size = 'md', shape = 'circle' }: { size?: AvatarSize; shape?: 'circle' | 'rounded' } = {}): string {
    return [
      'inline-flex shrink-0 items-center justify-center overflow-hidden bg-zinc-100 object-cover font-medium text-zinc-700 ring-1 ring-zinc-950/10 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-white/10',
      avatarSizes[size],
      shape === 'circle' ? 'rounded-full' : 'rounded-lg',
    ].join(' ');
  },
} as const;

export const table = {
  classes({
    density = 'comfortable',
    striped = false,
    mobileCards = false,
    stickyHeaders = false,
  }: {
    density?: TableDensity;
    striped?: boolean;
    mobileCards?: boolean;
    stickyHeaders?: boolean;
  } = {}): string {
    return [
      'w-full border-collapse text-left text-sm text-zinc-950 tabular-nums dark:text-zinc-50 [&_caption]:pb-4 [&_caption]:text-left [&_caption]:font-medium [&_th]:font-semibold [&_th]:text-zinc-600 dark:[&_th]:text-zinc-300 [&_tr]:border-b [&_tr]:border-zinc-200 dark:[&_tr]:border-zinc-700',
      mobileCards
        ? '[&_thead]:sr-only md:[&_thead]:not-sr-only md:[&_thead]:table-header-group [&_tbody]:block md:[&_tbody]:table-row-group [&_tbody_tr]:mb-3 [&_tbody_tr]:grid [&_tbody_tr]:grid-cols-1 [&_tbody_tr]:gap-x-4 [&_tbody_tr]:rounded-lg [&_tbody_tr]:border [&_tbody_tr]:p-4 sm:[&_tbody_tr]:grid-cols-2 md:[&_tbody_tr]:mb-0 md:[&_tbody_tr]:table-row md:[&_tbody_tr]:rounded-none md:[&_tbody_tr]:border-0 md:[&_tbody_tr]:border-b md:[&_tbody_tr]:p-0 [&_tbody_td]:block [&_tbody_th]:block md:[&_tbody_td]:table-cell md:[&_tbody_th]:table-cell [&_td]:min-w-0 [&_td]:break-words [&_th]:min-w-0 [&_th]:break-words md:[&_th]:px-4 md:[&_td]:px-4 [&_[data-slot=label]]:mb-1 [&_[data-slot=label]]:block [&_[data-slot=label]]:text-xs [&_[data-slot=label]]:font-semibold [&_[data-slot=label]]:text-zinc-600 dark:[&_[data-slot=label]]:text-zinc-400 md:[&_[data-slot=label]]:hidden'
        : '[&_th]:px-4 [&_td]:px-4 [&_[data-slot=label]]:hidden',
      density === 'compact' ? '[&_th]:py-2 [&_td]:py-2' : '[&_th]:py-3 [&_td]:py-4',
      striped ? '[&_tbody_tr:nth-child(even)]:bg-zinc-50 dark:[&_tbody_tr:nth-child(even)]:bg-zinc-900' : '',
      stickyHeaders
        ? 'md:[&_thead_th]:sticky md:[&_thead_th]:top-0 md:[&_thead_th]:z-10 md:[&_thead_th]:bg-white dark:md:[&_thead_th]:bg-zinc-900'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
} as const;

export const descriptionList = {
  classes(): string {
    return 'grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,1fr)_2fr] [&_dt]:font-medium [&_dt]:text-zinc-600 dark:[&_dt]:text-zinc-400 [&_dd]:text-zinc-950 dark:[&_dd]:text-zinc-50';
  },
} as const;

export const pagination = {
  classes(): string {
    return 'flex flex-wrap items-center gap-2';
  },
} as const;
