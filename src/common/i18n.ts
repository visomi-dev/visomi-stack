export const locales = ['es-419', 'en-US', 'pt-BR'] as const;
export const currencies = ['MXN', 'USD', 'BRL'] as const;

export type Locale = (typeof locales)[number];
export type Currency = (typeof currencies)[number];

export const DEFAULT_LOCALE: Locale = 'es-419';
export const DEFAULT_CURRENCY: Currency = 'MXN';

export enum LocaleEnum {
  ES_419 = 'es_419',
  EN_US = 'en_US',
}

export enum CurrencyEnum {
  MXN = 'MXN',
  USD = 'USD',
}
