export type ControlSize = 'sm' | 'md' | 'lg';

const controlBase =
  'ui-focus-ring block w-full min-w-0 rounded-lg border border-zinc-500 bg-white text-zinc-950 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-600 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:aria-invalid:border-red-400';
const controlSizes = {
  sm: 'min-h-11 px-3 py-2 text-sm',
  md: 'min-h-11 px-3 py-2.5 text-base',
  lg: 'min-h-12 px-4 py-3 text-lg',
} as const;
const selectionBase =
  'ui-focus-ring size-5 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50';

export const input = {
  classes({ size = 'md' }: { size?: ControlSize } = {}): string {
    return [controlBase, controlSizes[size]].join(' ');
  },
} as const;
export const textarea = {
  classes({ size = 'md' }: { size?: ControlSize } = {}): string {
    return [controlBase, 'min-h-28 resize-y', controlSizes[size]].join(' ');
  },
} as const;
export const select = {
  classes({ size = 'md' }: { size?: ControlSize } = {}): string {
    return [controlBase, 'cursor-pointer', controlSizes[size]].join(' ');
  },
} as const;
export const checkbox = {
  classes(): string {
    return [selectionBase, 'rounded'].join(' ');
  },
} as const;
export const radio = {
  classes(): string {
    return selectionBase;
  },
} as const;

export const toggle = {
  classes(): string {
    return "ui-focus-ring relative inline-block h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border border-zinc-500 bg-zinc-500 checked:border-blue-600 checked:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:content-[''] checked:before:translate-x-5 dark:bg-zinc-700 dark:checked:bg-blue-600 forced-colors:appearance-auto forced-colors:before:hidden";
  },
} as const;

export const fieldset = {
  classes(): string {
    return 'min-w-0 space-y-5 [&_legend]:mb-4 [&_legend]:font-heading [&_legend]:text-lg [&_legend]:font-semibold';
  },
} as const;
export const field = {
  classes({ compact = false }: { compact?: boolean } = {}): string {
    return [
      'flex min-w-0 flex-col',
      '[&_[data-slot=error]]:grid-rows-[0fr] [&_[data-slot=error]]:invisible [&_[data-slot=error]]:opacity-0',
      '[&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_[data-slot=error]]:grid-rows-[1fr] [&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_[data-slot=error]]:visible [&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_[data-slot=error]]:opacity-100 [&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_[data-slot=error]]:mt-0',
      '[&:not(:focus-within):is([data-invalid],[data-manual-invalid]):not(:has([data-slot=control]:placeholder-shown))_[data-slot=error]]:grid-rows-[1fr] [&:not(:focus-within):is([data-invalid],[data-manual-invalid]):not(:has([data-slot=control]:placeholder-shown))_[data-slot=error]]:visible [&:not(:focus-within):is([data-invalid],[data-manual-invalid]):not(:has([data-slot=control]:placeholder-shown))_[data-slot=error]]:opacity-100 [&:not(:focus-within):is([data-invalid],[data-manual-invalid]):not(:has([data-slot=control]:placeholder-shown))_[data-slot=error]]:mt-0',
      '[&:not(:focus-within):has([data-slot=control][aria-invalid=true]:not(:placeholder-shown))_[data-slot=error]]:grid-rows-[1fr] [&:not(:focus-within):has([data-slot=control][aria-invalid=true]:not(:placeholder-shown))_[data-slot=error]]:visible [&:not(:focus-within):has([data-slot=control][aria-invalid=true]:not(:placeholder-shown))_[data-slot=error]]:opacity-100 [&:not(:focus-within):has([data-slot=control][aria-invalid=true]:not(:placeholder-shown))_[data-slot=error]]:mt-0',
      '[[data-submitted]_&:not(:focus-within):has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_[data-slot=error]]:grid-rows-[1fr] [[data-submitted]_&:not(:focus-within):has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_[data-slot=error]]:visible [[data-submitted]_&:not(:focus-within):has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_[data-slot=error]]:opacity-100 [[data-submitted]_&:not(:focus-within):has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_[data-slot=error]]:mt-0',
      '[&:is([data-invalid],[data-manual-invalid])_:is([data-slot=control],[data-slot=radio-card])]:border-red-600 dark:[&:is([data-invalid],[data-manual-invalid])_:is([data-slot=control],[data-slot=radio-card])]:border-red-400',
      '[&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_:is([data-slot=control],[data-slot=radio-card])]:border-red-600 dark:[&:not(:focus-within):has([data-slot=control]:user-invalid:not(:placeholder-shown):not(:autofill))_:is([data-slot=control],[data-slot=radio-card])]:border-red-400',
      '[[data-submitted]_&:has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_:is([data-slot=control],[data-slot=radio-card])]:border-red-600 dark:[[data-submitted]_&:has([data-slot=control]:invalid,[data-slot=control][aria-invalid=true])_:is([data-slot=control],[data-slot=radio-card])]:border-red-400',
      compact ? 'gap-1.5 [&_[data-slot=error]]:-mt-1.5' : 'gap-2 [&_[data-slot=error]]:-mt-2',
    ].join(' ');
  },
} as const;
export const label = {
  classes({ inline = false }: { inline?: boolean } = {}): string {
    return [
      'text-sm font-medium text-zinc-950 dark:text-zinc-50',
      inline ? 'inline-flex min-h-11 cursor-pointer items-center gap-3' : 'block',
    ].join(' ');
  },
} as const;
export const description = {
  classes(): string {
    return 'text-sm leading-6 text-zinc-600 dark:text-zinc-400';
  },
} as const;
export const errorMessage = {
  classes(): string {
    return 'grid min-h-0 grid-rows-[1fr] text-sm leading-6 text-red-700 transition-[grid-template-rows,opacity,margin-top,visibility] duration-200 empty:hidden has-[>span:empty]:hidden motion-reduce:transition-none dark:text-red-300 [&>span]:min-h-0 [&>span]:overflow-hidden';
  },
} as const;
export const inputGroup = {
  classes(): string {
    return 'relative min-w-0 [&_[data-slot=prefix]]:pointer-events-none [&_[data-slot=prefix]]:absolute [&_[data-slot=prefix]]:inset-y-0 [&_[data-slot=prefix]]:left-3 [&_[data-slot=prefix]]:flex [&_[data-slot=prefix]]:items-center [&_[data-slot=prefix]]:text-zinc-500 dark:[&_[data-slot=prefix]]:text-zinc-400 [&:has([data-slot=prefix])_input]:pl-9 [&_[data-slot=suffix]]:pointer-events-none [&_[data-slot=suffix]]:absolute [&_[data-slot=suffix]]:inset-y-0 [&_[data-slot=suffix]]:right-3 [&_[data-slot=suffix]]:flex [&_[data-slot=suffix]]:items-center [&_[data-slot=suffix]]:text-zinc-500 dark:[&_[data-slot=suffix]]:text-zinc-400 [&:has([data-slot=suffix])_input]:pr-12';
  },
} as const;
export const radioCard = {
  classes(): string {
    return 'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-zinc-300 bg-white p-4 text-sm text-zinc-950 has-checked:border-blue-600 has-checked:bg-blue-50 has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950 dark:has-focus-visible:outline-blue-400';
  },
} as const;
