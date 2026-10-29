export type DialogSize = 'sm' | 'md' | 'lg';
const dialogSizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export const disclosure = {
  classes(): string {
    return 'rounded-xl border border-zinc-200 bg-white text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:rounded-lg [&_summary]:px-4 [&_summary]:py-3 [&_summary]:font-medium [&_summary]:outline-offset-2 [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-blue-600 dark:[&_summary:focus-visible]:outline-blue-400 [&>:not(summary)]:px-4 [&>:not(summary)]:pb-4';
  },
} as const;
export const dialog = {
  classes({ size = 'md' }: { size?: DialogSize } = {}): string {
    return [
      'm-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl backdrop:bg-zinc-950/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50',
      dialogSizes[size],
    ].join(' ');
  },
} as const;
