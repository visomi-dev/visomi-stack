import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

import { findUserById, resolveAuthUser, verifyPassword } from './auth-service';

type SerializedUser = {
  accountId: string;
  id: string;
  authenticationMethod?: 'passkey' | 'password';
  credentialId?: string;
};

passport.use(
  'local',
  new LocalStrategy({ passwordField: 'password', usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await verifyPassword(email, password);

      if (!user) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      return done(null, { ...(await resolveAuthUser(user)), authenticationMethod: 'password' });
    } catch (error) {
      return done(error as Error);
    }
  }),
);

passport.serializeUser((user, done) => {
  done(null, {
    accountId: user.accountId,
    credentialId: user.credentialId,
    id: user.id,
    authenticationMethod: user.authenticationMethod,
  });
});

passport.deserializeUser(async (serializedUser: SerializedUser, done) => {
  try {
    const user = await findUserById(serializedUser.id);

    if (!user) {
      return done(null, false);
    }

    return done(null, {
      ...(await resolveAuthUser(user)),
      authenticationMethod: serializedUser.authenticationMethod ?? 'password',
      credentialId: serializedUser.credentialId,
    });
  } catch (error) {
    return done(error as Error);
  }
});

export { passport };
