declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface User {
      accountId: string;
      email: string;
      emailVerifiedAt: string | null;
      id: string;
      role: string;
      authenticationMethod?: 'passkey' | 'password';
      credentialId?: string;
    }
  }
}

declare module 'express-session' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface SessionData {
    passport?: {
      user?: {
        accountId: string;
        id: string;
      };
    };
    resetPassword?: {
      challengeId: string;
      email: string;
      userId: string;
    };
    passkeyRegistration?: {
      challengeId: string;
      email: string;
      label: string;
      pinVerified: true;
      enrollmentId?: string;
    };
    authenticatedAt?: number;
    reauthenticatedAt?: number;
    passkeySecurityReauthenticatedAt?: number;
  }
}

export {};
