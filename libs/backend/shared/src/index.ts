export { createDatabase } from './lib/database/database';
export type { Database, DatabaseResource } from './lib/database/database';
export * as authSchema from './lib/database/schema-auth';
export { createSmtp, smtpConfig, MAIL_TRANSPORT } from './lib/mail/smtp';
export type { MailMessage, MailTransport, SmtpConfig } from './lib/mail/smtp';
export { AuthMail, renderMessage } from './lib/mail/messages';
export type { CodePurpose, SecurityNotice } from './lib/mail/messages';
export { createInjector, inject, InjectionToken, Injector, runInInjectionContext } from './lib/injection';
export type { Provider, Type } from './lib/injection';
export { DATABASE, DATABASE_POOL } from './lib/database/tokens';
export {
  REALTIME_PUBLISHER,
  createMemoryRealtimeTransport,
  createRealtimePublisher,
  subscribeRealtime,
} from './lib/realtime';
export type { RealtimePublisher, RealtimeRuntime, RealtimeTransport } from './lib/realtime';
export { createRedisRealtimeTransport } from './lib/realtime-redis';
