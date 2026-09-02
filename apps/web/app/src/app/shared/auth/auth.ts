import type { Signal } from '@angular/core';

import type {
  AuthUser,
  EmailOtpRequestPayload,
  EmailOtpResendPayload,
  EmailOtpResponse,
  EmailOtpVerifyPayload,
  RememberDevicePayload,
  SessionResponse,
  SessionUpgrade,
} from './auth.models';

export abstract class Auth {
  abstract readonly emailOtpSubmitting: Signal<boolean>;
  abstract readonly isAuthenticated: Signal<boolean>;
  abstract readonly passkeySubmitting: Signal<boolean>;
  abstract readonly sessionLoaded: Signal<boolean>;
  abstract readonly user: Signal<AuthUser | null>;

  abstract ensureSessionLoaded(): Promise<void>;
  abstract requestEmailOtp(payload: EmailOtpRequestPayload): Promise<EmailOtpResponse['data']>;
  abstract verifyEmailOtp(payload: EmailOtpVerifyPayload): Promise<SessionUpgrade>;
  abstract resendEmailOtp(payload: EmailOtpResendPayload): Promise<EmailOtpResponse['data']>;
  abstract rememberDevice(payload: RememberDevicePayload): Promise<void>;
  abstract signOut(): Promise<void>;
}

export type { SessionResponse };
