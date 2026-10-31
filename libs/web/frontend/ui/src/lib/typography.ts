export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'lead' | 'inherit';
export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'inverse' | 'inherit';
export type TextWeight = 'inherit' | 'normal' | 'medium' | 'semibold';
export type TextLeading = 'default' | 'relaxed';
export type HeadingSize = 'title' | 'label' | 'sm' | 'md' | 'lg' | 'xl' | 'section' | 'display' | 'hero';
export type HeadingTone = 'default' | 'accent' | 'inverse' | 'inherit';
export type CodeVariant = 'default' | 'plain' | 'terminal';

const textSizes = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  lead: 'text-base sm:text-lg',
  inherit: '',
} as const;
const textLeading = {
  default: {
    xs: 'leading-5',
    sm: 'leading-6',
    md: 'leading-7',
    lg: 'leading-8',
    lead: 'leading-7 sm:leading-8',
    inherit: '',
  },
  relaxed: { xs: 'leading-6', sm: 'leading-7', md: 'leading-8', lg: 'leading-8', lead: 'leading-8', inherit: '' },
} as const;
const textTones = {
  default: 'text-zinc-950 dark:text-zinc-50',
  muted: 'text-zinc-600 dark:text-zinc-400',
  subtle: 'text-zinc-500 dark:text-zinc-400',
  accent: 'text-blue-700 dark:text-blue-400',
  inverse: 'text-blue-50',
  inherit: 'text-inherit',
} as const;
const textWeights = { inherit: '', normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold' } as const;
const headingSizes = {
  title: 'font-heading text-3xl tracking-tight',
  label: 'font-sans text-sm tracking-normal',
  sm: 'font-heading text-lg tracking-tight',
  md: 'font-heading text-xl tracking-tight',
  lg: 'font-heading text-2xl tracking-tight sm:text-3xl',
  xl: 'font-heading text-4xl tracking-tight sm:text-5xl',
  section: 'font-heading text-3xl leading-tight tracking-tight sm:text-4xl lg:text-5xl',
  display: 'font-heading text-4xl leading-tight tracking-[-0.045em] sm:text-6xl',
  hero: 'font-heading text-5xl leading-[1.08] tracking-[-0.055em] sm:text-6xl lg:text-7xl',
} as const;
const headingTones = {
  default: textTones.default,
  accent: textTones.accent,
  inverse: 'text-white',
  inherit: 'text-inherit',
} as const;

export const heading = {
  classes({ size = 'lg', tone = 'default' }: { size?: HeadingSize; tone?: HeadingTone } = {}): string {
    return ['font-semibold text-balance', headingSizes[size], headingTones[tone]].join(' ');
  },
} as const;

export const text = {
  classes({
    size = 'md',
    tone = 'default',
    weight = 'inherit',
    leading = 'default',
    mono = false,
  }: {
    size?: TextSize;
    tone?: TextTone;
    weight?: TextWeight;
    leading?: TextLeading;
    mono?: boolean;
  } = {}): string {
    return [
      'text-pretty',
      textSizes[size],
      textLeading[leading][size],
      textTones[tone],
      textWeights[weight],
      mono ? 'font-mono' : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
} as const;

export type LinkVariant = 'default' | 'muted' | 'inverse';
export type LinkUnderline = 'always' | 'hover' | 'none';
export type LinkOptions = { variant?: LinkVariant; underline?: LinkUnderline };

const linkVariants = {
  default: 'text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
  muted:
    'text-zinc-600 hover:text-blue-700 aria-[current=page]:font-semibold aria-[current=page]:text-zinc-950 dark:text-zinc-400 dark:hover:text-blue-400 dark:aria-[current=page]:text-zinc-50',
  inverse: 'text-white hover:text-blue-50',
} as const;
const linkUnderlines = {
  always: 'underline',
  hover: 'no-underline hover:underline focus-visible:underline',
  none: 'no-underline',
} as const;

export const link = {
  classes({ variant = 'default', underline = 'always' }: LinkOptions = {}): string {
    return [
      'rounded-sm underline-offset-4 transition-colors motion-reduce:transition-none',
      variant === 'inverse'
        ? 'outline-2 outline-solid outline-transparent outline-offset-3 focus-visible:outline-white'
        : 'ui-focus-ring',
      linkVariants[variant],
      linkUnderlines[underline],
    ].join(' ');
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
  classes({ block = false, variant = 'default' }: { block?: boolean; variant?: CodeVariant } = {}): string {
    if (variant === 'terminal') {
      return [
        'font-mono bg-zinc-950 text-zinc-100',
        block
          ? 'ui-focus-ring block overflow-x-auto p-5 text-xs leading-7 whitespace-pre sm:p-6 sm:text-sm'
          : 'rounded px-1.5 py-0.5 text-sm',
      ].join(' ');
    }

    return [
      variant === 'plain' ? 'font-mono' : 'font-mono text-sm text-zinc-800 dark:text-zinc-200',
      variant === 'default' ? 'rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900' : '',
      block
        ? `block overflow-x-auto whitespace-pre${variant === 'default' ? ' p-4' : ''}`
        : variant === 'default'
          ? 'px-1.5 py-0.5'
          : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  captionClasses(): string {
    return 'font-mono text-xs text-zinc-400';
  },
} as const;
