import { toneClasses, type Tone } from './data';

export const alert = {
  classes({ tone = 'accent' }: { tone?: Tone } = {}): string {
    return ['grid gap-2 rounded-xl border p-4 text-sm leading-6', toneClasses[tone]].join(' ');
  },
} as const;
export const loader = {
  classes(): string {
    return 'inline-block size-5 shrink-0 rounded-full border-2 border-current border-r-transparent text-blue-600 motion-safe:animate-spin dark:text-blue-400';
  },
} as const;
