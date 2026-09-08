declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface User {
      accountId: string;
      authority?: 'restricted' | 'full';
      email: string;
      emailVerifiedAt: string | null;
      id: string;
      role: string;
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
        authority?: 'restricted' | 'full';
        id: string;
      };
    };
    authority?: 'restricted' | 'full';
    passkeyRegistration?: {
      accountId: string;
      challengeId: string;
      email: string;
      label: string;
      enrollmentId?: string;
    };
    authenticatedAt?: number;
    passkeySecurityReauthenticatedAt?: number;
    restrictedAuth?: {
      allowedOperations: string[];
      eligibleAccounts: Array<{ accountId: string; name: string; role: string }>;
      expiresAt: number;
      flowId: string;
      issuedAt: number;
      purpose: 'bootstrap_recovery';
      selectedAccountId?: string;
      userId: string;
      verifiedEmail: string;
    };
  }
}

export {};
