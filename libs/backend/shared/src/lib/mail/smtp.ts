import { createTransport } from 'nodemailer';

import { InjectionToken } from '../injection';

export type MailMessage = { to: string; subject: string; html: string; text: string };
export type MailTransport = { send(message: MailMessage): Promise<void>; close(): void };
export const MAIL_TRANSPORT = new InjectionToken<MailTransport>('mail transport');

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
  allowInsecureLocal?: boolean;
};

export function createSmtp(config: SmtpConfig): MailTransport {
  const local = ['localhost', '127.0.0.1', '::1'].includes(config.host);

  if (
    !config.host ||
    !config.from ||
    /[\r\n]/.test(config.from) ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    Boolean(config.user) !== Boolean(config.password) ||
    (config.allowInsecureLocal && !local)
  ) {
    throw new Error('smtp_configuration_invalid');
  }

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !(local && config.allowInsecureLocal),
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 4000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async send(message) {
      try {
        await transport.sendMail({ ...message, from: config.from });
      } catch {
        throw new Error('mail_delivery_failed');
      }
    },
    close() {
      transport.close();
    },
  };
}

export function smtpConfig(environment: NodeJS.ProcessEnv): SmtpConfig | undefined {
  if (!environment.SMTP_HOST) {
    return undefined;
  }

  return {
    host: environment.SMTP_HOST,
    port: Number(environment.SMTP_PORT ?? 587),
    secure: environment.SMTP_SECURE === 'true',
    from: environment.SMTP_FROM ?? '',
    user: environment.SMTP_USER,
    password: environment.SMTP_PASSWORD,
    allowInsecureLocal: environment.SMTP_ALLOW_INSECURE_LOCAL === 'true',
  };
}
