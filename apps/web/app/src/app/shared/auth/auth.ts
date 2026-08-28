import type { Signal } from '@angular/core';

import type {
  AuthChallenge,
  AuthenticatedResponse,
  AuthUser,
  ChallengeOrAuthenticatedResponse,
  ChallengeResponse,
  CredentialsPayload,
  SessionResponse,
} from './auth.models';

export type SignInWithPasswordResult = AuthChallenge | AuthenticatedResponse['data'];

export abstract class Auth {
  abstract readonly isAuthenticated: Signal<boolean>;
  abstract readonly pendingChallenge: Signal<AuthChallenge | null>;
  abstract readonly sessionLoaded: Signal<boolean>;
  abstract readonly submitting: Signal<boolean>;
  abstract readonly user: Signal<AuthUser | null>;
  abstract readonly verificationSubmitting: Signal<boolean>;

  abstract ensureSessionLoaded(): Promise<void>;

  abstract signInWithPassword(payload: CredentialsPayload): Promise<SignInWithPasswordResult>;

  abstract signUp(payload: CredentialsPayload): Promise<AuthChallenge>;

  abstract submitVerification(pin: string): Promise<AuthUser>;

  abstract resendVerification(): Promise<AuthChallenge>;

  abstract signOut(): Promise<void>;

  abstract requestPasswordReset(email: string): Promise<AuthChallenge | null>;

  abstract verifyPasswordReset(challengeId: string, pin: string): Promise<void>;

  abstract submitPasswordReset(password: string): Promise<void>;

  abstract clearPendingChallenge(): void;

  abstract setPendingVerification(challenge: AuthChallenge): void;
}

export type { SessionResponse, ChallengeResponse, ChallengeOrAuthenticatedResponse };
