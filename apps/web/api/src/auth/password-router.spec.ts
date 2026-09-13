import express, { json, type Request } from 'express';
import request from 'supertest';

import { authOpenApiPaths, authRouter } from './auth-router';
import { setUserPassword } from './auth-service';

jest.mock('./auth-service', () => ({
  ...jest.requireActual('./auth-service'),
  setUserPassword: jest.fn(),
}));

jest.mock('otplib', () => ({
  TOTP: class {
    generateSecret(): string {
      return 'TESTSECRET';
    }
  },
}));

import { errorHandler } from 'shared';

function createApp(): express.Express {
  const app = express();

  app.use(json());
  app.use('/auth', authRouter);
  app.use(errorHandler);

  return app;
}

function createRestrictedApp(expiresAt = Date.now() + 60_000): express.Express {
  const app = express();

  app.use(json());
  app.use((req: Request, _res, next) => {
    req.user = {
      accountId: 'account-1',
      authority: 'restricted',
      email: 'person@example.test',
      emailVerifiedAt: new Date().toISOString(),
      id: 'user-1',
      role: 'owner',
    };
    Object.assign(req, {
      session: {
        authority: 'restricted',
        restrictedAuth: {
          allowedOperations: ['password:set'],
          eligibleAccounts: [{ accountId: 'account-1', name: 'Account', role: 'owner' }],
          expiresAt,
          flowId: 'flow-1',
          issuedAt: Date.now(),
          isNewUser: false,
          purpose: 'existing_account_recovery' as const,
          selectedAccountId: 'account-1',
          userId: 'user-1',
          verifiedEmail: 'person@example.test',
        },
      },
    });
    next();
  });
  app.use('/auth', authRouter);
  app.use(errorHandler);

  return app;
}

describe('password authentication routes', () => {
  beforeEach(() => jest.mocked(setUserPassword).mockReset());

  it('documents and completes password setup from a restricted recovery session', async () => {
    expect(authOpenApiPaths['/auth/password/set']).toEqual(expect.any(Object));

    const response = await request(createRestrictedApp())
      .post('/auth/password/set')
      .set('Origin', 'http://localhost:8080')
      .send({ password: 'a secure password' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ passwordSet: true });
    expect(setUserPassword).toHaveBeenCalledWith('user-1', 'a secure password');
  });

  it('rejects malformed passwords and unavailable restricted sessions', async () => {
    const malformed = await request(createRestrictedApp())
      .post('/auth/password/set')
      .set('Origin', 'http://localhost:8080')
      .send({ password: 'too short' });
    const unavailable = await request(createApp())
      .post('/auth/password/set')
      .set('Origin', 'http://localhost:8080')
      .send({ password: 'a secure password' });

    expect(malformed.status).toBe(400);
    expect(unavailable.status).toBe(401);
    expect(unavailable.body.code).toBe('restricted_session_required');
  });

  it('rejects expired restricted sessions', async () => {
    const response = await request(createRestrictedApp(Date.now() - 1))
      .post('/auth/password/set')
      .set('Origin', 'http://localhost:8080')
      .send({ password: 'a secure password' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('restricted_session_required');
    expect(setUserPassword).not.toHaveBeenCalled();
  });

  it('rejects password sign-in while the security prerequisites are disabled', async () => {
    const response = await request(createApp())
      .post('/auth/password/sign-in')
      .set('Origin', 'http://localhost:8080')
      .send({ email: 'person@example.test', password: 'a secure password' });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('password_auth_disabled');
  });

  it('validates password sign-in input before reaching the disabled guard', async () => {
    const response = await request(createApp())
      .post('/auth/password/sign-in')
      .set('Origin', 'http://localhost:8080')
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(400);
  });

  it('documents signup and reset contracts and validates their required fields', async () => {
    expect(authOpenApiPaths['/auth/password/sign-up']).toEqual(expect.any(Object));
    expect(authOpenApiPaths['/auth/password/sign-up/verify']).toEqual(expect.any(Object));
    expect(authOpenApiPaths['/auth/password/reset/request']).toEqual(expect.any(Object));
    expect(authOpenApiPaths['/auth/password/reset/complete']).toEqual(expect.any(Object));

    const signup = await request(createApp())
      .post('/auth/password/sign-up')
      .set('Origin', 'http://localhost:8080')
      .send({ email: 'person@example.test', password: 'short' });
    const reset = await request(createApp())
      .post('/auth/password/reset/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId: 'not-a-uuid', emailCode: '123456', password: 'a secure password' });

    expect(signup.status).toBe(400);
    expect(reset.status).toBe(400);
  });
});
