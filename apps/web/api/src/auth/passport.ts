import passport from 'passport';

import { findUserById, resolveAuthUser } from './auth-service';

type SerializedUser = {
  accountId: string;
  authority: 'restricted' | 'full';
  id: string;
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
    role: user.role,
  };
}

passport.serializeUser((user: Express.User, done) => {
  done(null, {
    accountId: user.accountId,
    authority: (user as AuthorizedUser).authority ?? 'full',
    id: user.id,
  } satisfies SerializedUser);
});

passport.deserializeUser(async (serializedUser: SerializedUser, done) => {
  try {
    const user = await findUserById(serializedUser.id);

    if (!user) {
      return done(null, false);
    }

    const authUser = await resolveAuthUser(user);

    return done(null, toExpressUser({ ...authUser, authority: serializedUser.authority }));
  } catch (error) {
    return done(error as Error);
  }
});

export { passport };
export type SessionAuthority = 'restricted' | 'full';
