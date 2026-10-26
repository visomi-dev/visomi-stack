export { createDatabase } from './lib/database/database';
export type { Database, DatabaseResource } from './lib/database/database';
export * as authSchema from './lib/database/schema-auth';
export { createSmtp, smtpConfig } from './lib/mail/smtp';
export type { MailMessage, MailTransport, SmtpConfig } from './lib/mail/smtp';
export { AuthMail, renderMessage } from './lib/mail/messages';
export type { CodePurpose, SecurityNotice } from './lib/mail/messages';
