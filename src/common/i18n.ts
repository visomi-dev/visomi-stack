export const locales = ['es_419', 'en_US', 'pt_BR'] as const;
export const currencies = ['MXN', 'USD', 'BRL'] as const;

export type Locale = (typeof locales)[number];
export type Currency = (typeof currencies)[number];

export const DEFAULT_LOCALE: Locale = 'es_419';
export const DEFAULT_CURRENCY: Currency = 'MXN';

export enum LocaleEnum {
  ES_419 = 'es_419',
  EN_US = 'en_US',
}

export enum CurrencyEnum {
  MXN = 'MXN',
  USD = 'USD',
}
