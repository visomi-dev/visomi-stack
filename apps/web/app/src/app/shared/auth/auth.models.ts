export type FlowKind = 'bootstrap_recovery';

export type ResponseEnvelope<T> = {
  status?: number;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
};

export type AuthUser = {
  accountId: string;
  email: string;
  emailVerifiedAt: string | null;
  id: string;
  role: string;
};

export type EmailOtpResponse = ResponseEnvelope<{
  flowId: string;
  resendAvailableAt: string;
}>;

export type RestrictedSession = {
  kind: 'restricted';
  flowId: string;
  user: AuthUser;
};

export type FullSession = {
  kind: 'full';
  user: AuthUser;
};

export type SessionUpgrade = RestrictedSession | FullSession;

export type SessionUpgradeResponse = ResponseEnvelope<SessionUpgrade>;

export type SessionResponse = ResponseEnvelope<{
  authenticated: boolean;
  user: AuthUser | null;
}>;

export type MessageResponse = ResponseEnvelope<null>;

export type EmailOtpRequestPayload = { email: string };
export type EmailOtpVerifyPayload = { flowId: string; pin: string };
export type EmailOtpResendPayload = { flowId: string };

export type RememberDevicePayload = EmailOtpVerifyPayload;
