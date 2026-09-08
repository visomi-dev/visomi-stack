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
  authenticated: false;
  expiresAt: string;
  user: null;
  verifiedEmail: string;
};

export type FullSession = {
  authenticated: true;
  kind: 'full';
  user: AuthUser;
};

export type SessionUpgrade = RestrictedSession | FullSession;

export type SessionUpgradeResponse = ResponseEnvelope<SessionUpgrade>;

export type SessionResponse = ResponseEnvelope<{
  authenticated: boolean;
  kind: 'anonymous' | 'restricted' | 'full';
  user: AuthUser | null;
  expiresAt?: string;
  verifiedEmail?: string;
}>;

export type RestrictedAccount = { accountId: string; name: string; role: string; selected?: boolean };

export type MessageResponse = ResponseEnvelope<null>;

export type EmailOtpRequestPayload = { email: string };
export type EmailOtpVerifyPayload = { flowId: string; pin: string };
export type EmailOtpResendPayload = { flowId: string };
export type IdentityFlowState =
  | 'passkey'
  | 'identify'
  | 'verify_new_email'
  | 'authorize_existing_account'
  | 'enroll_passkey'
  | 'complete';
export type IdentityFlow = {
  flowId: string;
  state: IdentityFlowState;
  expiresAt?: string;
  google?: { enabled: boolean; clientId: string | null };
  nonce?: string;
};
