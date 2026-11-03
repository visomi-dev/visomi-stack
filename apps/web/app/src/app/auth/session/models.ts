export type Access = 'anonymous' | 'unverified' | 'full' | 'recovery' | 'enrollment';
export type Method = 'passkey' | 'password' | 'google' | 'recovery' | 'device';
export type SessionSnapshot = {
  authenticated: boolean;
  user: { id: string; email: string | null; emailVerified: boolean } | null;
  access: Access;
  method: Method | null;
  nextStep: 'verify_email' | 'add_email' | 'enroll_method' | null;
};
export type SessionView = SessionSnapshot & { csrfToken: string };
export type SessionStatus = 'loading' | 'ready' | 'unavailable';
export type AuthRenderContext = { available: boolean; session: SessionSnapshot | null };
export type Pending = { flowId: string; expiresAt: string };
export type Factor = { kind: 'email' | 'totp' | 'recovery_code'; code: string };
export type FactorPending = Pending & { factor: 'email' | 'totp' };
export type Providers = {
  passkey: boolean;
  password: boolean;
  google: { enabled: boolean; clientId: string | null };
  totp: boolean;
};
export type Notified = { notificationSent?: boolean };
export type SessionResult = SessionView & Notified;

export function isSession(value: unknown): value is SessionView {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const session = value as Partial<SessionView>;

  if (
    typeof session.csrfToken !== 'string' ||
    !session.csrfToken ||
    typeof session.authenticated !== 'boolean' ||
    !['anonymous', 'unverified', 'full', 'recovery', 'enrollment'].includes(session.access ?? '')
  ) {
    return false;
  }

  if (session.user === null) {
    return (
      session.access === 'anonymous' && !session.authenticated && session.method === null && session.nextStep === null
    );
  }

  if (
    !session.user ||
    typeof session.user.id !== 'string' ||
    typeof session.user.emailVerified !== 'boolean' ||
    !(session.user.email === null || typeof session.user.email === 'string') ||
    !session.authenticated ||
    !['passkey', 'password', 'google', 'recovery', 'device'].includes(session.method ?? '')
  ) {
    return false;
  }

  if (session.access === 'full') {
    return session.user.emailVerified && session.nextStep === null;
  }

  if (session.access === 'unverified') {
    return session.nextStep === 'add_email' || session.nextStep === 'verify_email';
  }

  return (session.access === 'recovery' || session.access === 'enrollment') && session.nextStep === 'enroll_method';
}
