export const visitPeriods = [7, 30] as const;

export type VisitPeriod = (typeof visitPeriods)[number];
export type VisitLocale = 'en' | 'es';
export type VisitPage = { page: string; locale: VisitLocale };
export type VisitCount = VisitPage & { day: string; views: number };
export type VisitSummary =
  { state: 'disabled' | 'unavailable' } | { state: 'ready'; period: VisitPeriod; firstDay: string; days: VisitCount[] };

export const stackVisitPages = ['home', 'architecture', 'docs', 'ui', 'app-foundations', 'app-dashboard'] as const;

export function appVisitPage(path: string): VisitPage | undefined {
  const match = /^\/app\/(en|es)\/(foundations|home)\/?$/.exec(path);

  if (match) {
    return { locale: match[1] === 'es' ? 'es' : 'en', page: match[2] === 'home' ? 'app-dashboard' : 'app-foundations' };
  }

  return;
}

export function siteVisitPage(path: string): VisitPage | undefined {
  const match = /^\/(en|es)(?:\/(architecture|docs|ui))?\/?$/.exec(path);

  return match ? { locale: match[1] === 'es' ? 'es' : 'en', page: match[2] || 'home' } : undefined;
}
