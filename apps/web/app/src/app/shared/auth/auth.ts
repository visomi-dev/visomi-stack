import type { Signal } from '@angular/core';

import type {
  AuthUser,
  EmailOtpRequestPayload,
  EmailOtpResendPayload,
  EmailOtpResponse,
  EmailOtpVerifyPayload,
  SessionResponse,
  SessionUpgrade,
  RestrictedAccount,
  IdentityFlow,
} from './auth.models';

export abstract class Auth {
  abstract readonly emailOtpSubmitting: Signal<boolean>;
  abstract readonly isAuthenticated: Signal<boolean>;
  abstract readonly passkeySubmitting: Signal<boolean>;
  abstract readonly sessionLoaded: Signal<boolean>;
  abstract readonly user: Signal<AuthUser | null>;

  abstract startIdentityFlow(): Promise<IdentityFlow>;
  abstract ensureSessionLoaded(force?: boolean): Promise<void>;
  abstract requestEmailOtp(payload: EmailOtpRequestPayload): Promise<EmailOtpResponse['data']>;
  abstract verifyEmailOtp(payload: EmailOtpVerifyPayload): Promise<SessionUpgrade>;
  abstract getRestrictedAccounts(): Promise<RestrictedAccount[]>;
  abstract resendEmailOtp(payload: EmailOtpResendPayload): Promise<EmailOtpResponse['data']>;
  abstract selectRestrictedAccount(accountId: string): Promise<RestrictedAccount>;
  abstract signOut(): Promise<void>;
}

export type { SessionResponse };
