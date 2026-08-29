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
    title: 'A full-stack foundation for products people can trust.',
    description:
      'Learn how Visomi Stack combines a full-stack architecture with Angular, Astro, Node, passkey-first authentication, zero-knowledge persistence, and Themis-powered delivery workflows in one reusable foundation.',
    hero: 'Understand the architecture, security model, and delivery loop behind Visomi Stack.',
  },
  es: {
    eyebrow: 'Template de aplicaciones listo para producción',
    title: 'Una base full-stack para productos en los que se puede confiar.',
    description:
      'Conoce cómo Visomi Stack combina una arquitectura full-stack con Angular, Astro, Node, autenticación passkey-first, persistencia zero-knowledge y workflows potenciados por Themis en una base reusable.',
    hero: 'Entiende la arquitectura, el modelo de seguridad y el ciclo de entrega detrás de Visomi Stack.',
  },
};

const getSiteContent = (locale: Locale) => siteContent[locale];

export type { Locale, SiteCopy };
export { getSiteContent };
