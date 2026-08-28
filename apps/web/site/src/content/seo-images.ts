type Locale = 'en' | 'es';

type SeoImage = {
  alt: string;
  image: string;
};

const IMAGE_VERSION = '2026-04-13';

const appendVersion = (path: string) => `${path}?v=${IMAGE_VERSION.replace(/\//g, '.')}`;

const seoImagesByPage: Record<string, Record<Locale, SeoImage>> = {
  home: {
    en: {
      alt: 'Themis AI-Integrated Technical Ledger preview',
      image: appendVersion('/images/seo/en/home.png'),
    },
    es: {
      alt: 'Vista previa de Themis Ledger técnico con IA integrada',
      image: appendVersion('/images/seo/es/home.png'),
    },
  },
};

const getSeoImage = (page: string, locale: Locale): SeoImage => {
  const pageImages = seoImagesByPage[page];

  if (!pageImages) {
    throw new Error(`SEO images not defined for page: ${page}`);
  }

  return pageImages[locale];
};

export { getSeoImage };
export type { Locale, SeoImage };
