type Locale = 'en' | 'es';

type SiteCopy = {
  description: string;
  eyebrow: string;
  hero: string;
  title: string;
};

const siteContent: Record<Locale, SiteCopy> = {
  en: {
    eyebrow: 'Production-ready application template',
    title: 'Build your next product on a stack that is ready to grow.',
    description:
      'Visomi Stack combines a modern full-stack architecture, passkey-first authentication, zero-knowledge persistence, and Themis-powered delivery workflows.',
    hero: 'Start with the boring infrastructure already solved, then spend your time building the product that matters.',
  },
  es: {
    eyebrow: 'Template de aplicaciones listo para producción',
    title: 'Construye tu próximo producto sobre una base preparada para crecer.',
    description:
      'Visomi Stack combina una arquitectura full-stack moderna, autenticación passkey-first, persistencia zero-knowledge y workflows potenciados por Themis.',
    hero: 'Empieza con la infraestructura resuelta y dedica tu tiempo al producto que quieres construir.',
  },
};

const getSiteContent = (locale: Locale) => siteContent[locale];

export type { Locale, SiteCopy };
export { getSiteContent };
