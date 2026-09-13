import passport from 'passport';

import { findUserById, resolveAuthUser, resolveAuthUserForAccount } from './auth-service';

type SerializedUser = {
  accountId: string;
  authority: 'restricted' | 'full';
  id: string;
  authenticationMethod?: Express.User['authenticationMethod'];
  secondFactor?: Express.User['secondFactor'];
  authVersion?: number;
};

type AuthorizedUser = Awaited<ReturnType<typeof resolveAuthUser>> & {
  authority: 'restricted' | 'full';
};

function toExpressUser(user: AuthorizedUser) {
  return {
    accountId: user.accountId,
    authority: user.authority,
    credentialId: undefined as string | undefined,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    id: user.id,
    authenticationMethod: user.authenticationMethod,
    secondFactor: user.secondFactor,
    authVersion: user.authVersion,
    role: user.role,
  };
}

passport.serializeUser((user: Express.User, done) => {
  done(null, {
    accountId: user.accountId,
    authority: (user as AuthorizedUser).authority ?? 'full',
    id: user.id,
    authenticationMethod: user.authenticationMethod,
    secondFactor: user.secondFactor,
    authVersion: user.authVersion,
  } satisfies SerializedUser);
});

passport.deserializeUser(async (serializedUser: SerializedUser, done) => {
  try {
    const user = await findUserById(serializedUser.id);

    if (!user) {
      return done(null, false);
    }

    if (
      (serializedUser.authVersion !== undefined && serializedUser.authVersion !== user.authVersion) ||
      (serializedUser.authVersion === undefined && user.authVersion !== 1)
    ) {
      return done(null, false);
    }

    const authUser = await resolveAuthUserForAccount(user, serializedUser.accountId);

    return done(null, {
      ...toExpressUser({ ...authUser, authority: serializedUser.authority }),
      authenticationMethod: serializedUser.authenticationMethod,
      secondFactor: serializedUser.secondFactor,
      authVersion: serializedUser.authVersion,
    });
  } catch (error) {
    return done(error as Error);
  }
});

export { passport };
export type SessionAuthority = 'restricted' | 'full';
