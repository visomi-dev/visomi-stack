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
    subject: 'Recuperación de contraseña',
    preview: 'Hola {{name}}, recupera tu contraseña',
    title: 'Recuperación de contraseña',
    greetings: 'Hola {{name}}',
    instructions:
      'Para recuperar tu contraseña, ingresa el siguiente código en la aplicación:',
  }),
  en_US: Object.freeze({
    logoAlt: 'VisomiStack logo',
    from: 'VisomiStack <hi@visomi.dev>',
    subject: 'Password recovery',
    preview: 'Hi {{name}}, recover your password',
    title: 'Password recovery',
    greetings: 'Hi {{name}}',
    instructions:
      'To recover your password, enter the following code in the application:',
  }),
  pt_BR: Object.freeze({
    logoAlt: 'Logotipo do VisomiStack',
    from: 'VisomiStack <hi@visomi.dev>',
    subject: 'Recuperação de senha',
    preview: 'Oi {{name}}, recupere sua senha',
    title: 'Recuperação de senha',
    greetings: 'Oi {{name}}',
    instructions:
      'Para recuperar sua senha, insira o seguinte código no aplicativo:',
  }),
});
