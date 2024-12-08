import { i18n } from '~/common';

export const templates = Object.freeze<
  Record<i18n.Locale, Record<'signUp' | 'forgotPassword', string>>
>({
  es_419: {
    signUp: 'ES_LA_SIGN_UP',
    forgotPassword: 'ES_LA_FORGOTTEN_PASSWORD',
  },
  en_US: {
    signUp: 'EN_US_SIGN_UP',
    forgotPassword: 'EN_US_FORGOTTEN_PASSWORD',
  },
  pt_BR: {
    signUp: 'PT_BR_SIGN_UP',
    forgotPassword: 'PT_BR_FORGOTTEN_PASSWORD',
  },
});
