import { i18n } from '~/common';

export const messages = Object.freeze<
  Record<
    i18n.Locale,
    {
      logoAlt: string;
      from: string;
      subject: string;
      preview: string;
      title: string;
      greetings: string;
      instructions: string;
    }
  >
>({
  es_419: Object.freeze({
    logoAlt: 'Logotipo de VisomiStack',
    from: 'VisomiStack <hola@visomi.dev>',
    subject: 'Verifica tu cuenta',
    preview: 'Hola {{name}}, verifica tu cuenta',
    title: 'Verifica tu cuenta',
    greetings: 'Hola {{name}}',
    instructions:
      'Ingresa el siguiente código de verificación en la aplicación',
  }),
  en_US: Object.freeze({
    logoAlt: 'VisomiStack logo',
    from: 'VisomiStack <hi@visomi.dev>',
    subject: 'Verify your account',
    preview: 'Hi {{name}}, verify your account',
    title: 'Verify your account',
    greetings: 'Hi {{name}}',
    instructions: 'Enter the following verification code in the application',
  }),
  pt_BR: Object.freeze({
    logoAlt: 'Logotipo do VisomiStack',
    from: 'VisomiStack <hi@visomi.dev>',
    subject: 'Verifique sua conta',
    preview: 'Oi {{name}}, verifique sua conta',
    title: 'Verifique sua conta',
    greetings: 'Oi {{name}}',
    instructions: 'Insira o seguinte código de verificação no aplicativo',
  }),
});
