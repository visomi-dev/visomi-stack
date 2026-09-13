type Locale = 'en' | 'es';

type SiteCopy = {
  description: string;
  eyebrow: string;
  hero: string;
  title: string;
};

const siteContent: Record<Locale, SiteCopy> = {
  en: {
    eyebrow: 'Modular application foundation',
    title: 'One public origin. Explicit runtime and trust boundaries.',
    description:
      'Explore how Visomi Stack provides a modular full-stack foundation with Angular, Astro, Express, workers, realtime delivery, passwordless identity, a zero-knowledge architecture under review, and the local Themis workflow.',
    hero: 'Understand the runtime topology, plaintext authority, cloud control plane, and evidence-driven delivery loop.',
  },
  es: {
    eyebrow: 'Base modular para aplicaciones',
    title: 'Un origen público. Límites explícitos de runtime y confianza.',
    description:
      'Descubre cómo Visomi Stack ofrece una base full-stack modular con Angular, Astro, Express, workers, realtime, identidad passwordless, una arquitectura zero-knowledge bajo revisión y el workflow local Themis.',
    hero: 'Entiende la topología de runtimes, la autoridad sobre plaintext, el control plane cloud y el ciclo de entrega basado en evidencia.',
  },
};

const getSiteContent = (locale: Locale) => siteContent[locale];

export type { Locale, SiteCopy };
export { getSiteContent };
