import { en } from './en';
import { es } from './es';

export type SiteLocale = 'en' | 'es';
export type SitePage = 'home' | 'architecture' | 'docs' | 'ui' | 'foundations';

export const repositoryUrl = 'https://github.com/visomi-dev/visomi-stack';
const paths: Record<SitePage, string> = {
  home: '',
  architecture: 'architecture/',
  docs: 'docs/',
  ui: 'ui/',
  foundations: 'foundations/',
};

export function sitePath(locale: SiteLocale, page: SitePage): string {
  return `/${locale}/${paths[page]}`;
}

export function isSiteLocale(value: string | undefined): value is SiteLocale {
  return value === 'en' || value === 'es';
}

export const siteCopy = { en, es } as const;
