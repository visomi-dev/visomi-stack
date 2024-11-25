export const PAGE_CLASSES =
  /* tw */ 'animation-fade w-full flex flex-col h-full';

export const AUTH_PAGE_CLASSES =
  /* tw */ 'animation-fade h-svh w-svw flex flex-col justify-center items-center';

export const sizes = Object.freeze({
  sm: /* tw */ 'p-1',
  md: /* tw */ 'p-2',
  lg: /* tw */ 'p-3',
});

export const solidColors = Object.freeze({
  default:
    /* tw */ 'border-slate-500 focus:ring-slate-500 bg-white dark:bg-transparent dark:text-white',
  primary:
    /* tw */ 'border-primary bg-primary focus:ring-primary text-white dark:border-white',
  blue: /* tw */ 'border-blue-500 bg-blue-500 text-white focus:ring-blue-500',
  green:
    /* tw */ 'border-green-500 bg-green-500 text-white focus:ring-green-500',
  yellow:
    /* tw */ 'border-yellow-500 bg-yellow-500 text-white focus:ring-yellow-500',
  red: /* tw */ 'border-red-500 bg-red-500 text-white focus:ring-red-500',
});

export const outlineColors = Object.freeze({
  default: /* tw */ 'border-slate-500 bg-transparent focus:ring-slate-500',
  primary: /* tw */ 'border-primary focus:ring-primary bg-transparent',
  blue: /* tw */ 'border-blue-500 bg-transparent focus:ring-blue-500',
  green: /* tw */ 'border-green-500 bg-transparent focus:ring-green-500',
  yellow: /* tw */ 'border-yellow-500 bg-transparent focus:ring-yellow-500',
  red: /* tw */ 'border-red-500 bg-transparent focus:ring-red-500',
});

export const LOADING_CLASSES =
  /* tw */ 'pointer-events-none relative bg-opacity-90 text-transparent! after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent';

export type Variant = 'solid' | 'outline';
export type Size = keyof typeof sizes;
export type SolidColor = keyof typeof solidColors;
export type OutlineColor = keyof typeof outlineColors;
export type Color = SolidColor;
