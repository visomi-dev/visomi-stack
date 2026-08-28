export type AuthMode = 'sign_in' | 'sign_up';

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

export type AuthChallenge = {
  challengeId: string;
  email: string;
  expiresAt: string;
  purpose: AuthMode;
  rememberDevice?: boolean;
};

export type SessionResponse = ResponseEnvelope<{
  authenticated: boolean;
  user: AuthUser | null;
}>;

export type AuthenticatedResponse = ResponseEnvelope<{
  authenticated: true;
  user: AuthUser;
}>;

export type ChallengeResponse = ResponseEnvelope<AuthChallenge>;

export type ChallengeOrAuthenticatedResponse = ResponseEnvelope<AuthChallenge | AuthenticatedResponse['data']>;

export type MessageResponse = ResponseEnvelope<null>;

export type CredentialsPayload = {
  email: string;
  password: string;
  rememberDevice?: boolean;
};
