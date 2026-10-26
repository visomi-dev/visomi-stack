import { AuthHttpError } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, destroySession, establishSession, factor, identifier, sessionView, text } from './http';
import { validPrincipal } from './identity';
import { normalizeEmail } from './secrets';
import type { AuthRuntime } from './runtime';

export function accountRouter(auth: AuthRuntime) {
  const router = Router();
  const { accounts, google, recovery, devices, config } = auth;
  const current = (request: Request) => {
    if (!validPrincipal(request.user)) {
      throw new AuthHttpError(401, 'authentication_required');
    }

    return request.user;
  };
  const anonymous = (request: Request) => {
    if (request.user) {
      throw new AuthHttpError(403, 'anonymous_session_required');
    }
  };
  const result = async (request: Request, response: Response, user: Express.User | null, extras = {}) => {
    if (user) {
      await establishSession(request, user, auth);
      response.json({ ...sessionView(request), ...extras });
    } else {
      await destroySession(request);
      response.clearCookie(config.cookieName, { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' });
      response.status(204).end();
    }
  };

  router.get('/providers', (_request, response) =>
    response.json({
      passkey: true,
      password: true,
      google: { enabled: Boolean(config.googleClientId), clientId: config.googleClientId ?? null },
      totp: Boolean(config.totpKey),
    }),
  );
  router.post('/password/sign-up', async (request, response) => {
    anonymous(request);
    const input = body(request, ['email', 'password']);
    const user = await accounts.signup(request.sessionID, normalizeEmail(input.email), text(input.password));

    await establishSession(request, user, auth);
    const verification = await accounts.emailStart(request.sessionID, user);

    response.status(201).json({ ...sessionView(request), ...verification });
  });
  router.post('/email/request', async (request, response) => {
    const input = body(request, ['email']);
    const pending = await accounts.emailStart(
      request.sessionID,
      current(request),
      input.email === undefined ? undefined : normalizeEmail(input.email),
    );

    response.status(202).json(pending);
  });
  router.post('/email/verify', async (request, response) => {
    const input = body(request, ['flowId', 'code']);
    const verified = await accounts.emailComplete(
      request.sessionID,
      current(request),
      identifier(input.flowId),
      text(input.code, 6),
    );

    await result(request, response, verified.user);
  });
  router.post('/email/change/request', async (request, response) => {
    const input = body(request, ['email']);
    const pending = await accounts.emailStart(request.sessionID, current(request), normalizeEmail(input.email), true);

    response.status(202).json(pending);
  });
  router.post('/email/change/verify', async (request, response) => {
    const input = body(request, ['flowId', 'code']);
    const changed = await accounts.emailComplete(
      request.sessionID,
      current(request),
      identifier(input.flowId),
      text(input.code, 6),
      true,
    );
    const notificationSent = await accounts.notify(changed.previousEmail, 'email_changed');

    await result(request, response, changed.user, { notificationSent });
  });
  router.post('/password/sign-in', async (request, response) => {
    anonymous(request);
    const input = body(request, ['email', 'password']);
    const pending = await accounts.signIn(request.sessionID, normalizeEmail(input.email), text(input.password));

    response.status(202).json(pending);
  });
  router.post('/password/verify', async (request, response) => {
    anonymous(request);
    const input = body(request, ['flowId', 'factor']);
    const user = await accounts.loginComplete(request.sessionID, identifier(input.flowId), factor(input.factor));

    await result(request, response, user);
  });
  router.post('/challenges/resend', async (request, response) => {
    const input = body(request, ['flowId']);
    const pending = await accounts.flows.resend(request.sessionID, identifier(input.flowId));

    response.status(202).json(pending);
  });
  router.post('/reauth/password/start', async (request, response) => {
    const input = body(request, ['password']);
    const pending = await accounts.reauthStart(request.sessionID, current(request), text(input.password));

    response.status(202).json(pending);
  });
  router.post('/reauth/password/complete', async (request, response) => {
    const input = body(request, ['flowId', 'factor']);
    const user = await accounts.reauthComplete(
      request.sessionID,
      current(request),
      identifier(input.flowId),
      factor(input.factor),
    );

    await result(request, response, user);
  });
  for (const operation of ['add', 'change', 'remove'] as const) {
    router.post(`/password/${operation}`, async (request, response) => {
      const input = body(request, operation === 'remove' ? [] : ['password']);
      const user = current(request);
      const updated = await accounts.passwordChange(
        request.sessionID,
        user,
        operation === 'remove' ? null : text(input.password),
        operation === 'add',
      );
      const notificationSent = await accounts.notify(user.email, 'password_changed');

      await result(request, response, updated, { notificationSent });
    });
  }
  router.get('/methods', async (request, response) => {
    const methods = await accounts.overview(current(request));

    response.json(methods);
  });
  router.post('/google/start', async (request, response) => {
    const input = body(request, ['intent']);
    const intent = input.intent ?? 'login';

    if (!['login', 'link', 'reauth'].includes(String(intent))) {
      throw new AuthHttpError(403, 'intent_invalid');
    }

    if (intent === 'login') {
      anonymous(request);
    }

    const pending = await google.start(request.sessionID, intent as 'login' | 'link' | 'reauth', request.user);

    response.status(201).json(pending);
  });
  router.post('/google/complete', async (request, response) => {
    const input = body(request, ['flowId', 'idToken']);
    const completed = await google.complete(
      request.sessionID,
      identifier(input.flowId),
      text(input.idToken, 16384),
      request.user,
    );

    if (completed.pending) {
      response.status(202).json(completed.pending);
    } else {
      await result(request, response, completed.user!);
    }
  });
  router.post('/google/email/verify', async (request, response) => {
    const input = body(request, ['flowId', 'code']);
    const user = await google.emailComplete(
      request.sessionID,
      identifier(input.flowId),
      text(input.code, 6),
      request.user,
    );

    await result(request, response, user);
  });
  router.delete('/google/:id', async (request, response) => {
    const user = current(request);
    const updated = await google.unlink(request.sessionID, user, identifier(request.params.id));
    const notificationSent = await accounts.notify(user.email, 'google_unlinked');

    await result(request, response, updated, { notificationSent });
  });
  router.post('/totp/setup', async (request, response) => {
    body(request, []);
    const setup = await accounts.factors.setup(request.sessionID, current(request));

    response.status(201).json(setup);
  });
  router.post('/totp/confirm', async (request, response) => {
    const input = body(request, ['enrollmentId', 'code']);
    const user = current(request);
    const id = identifier(input.enrollmentId);

    await accounts.flows.limit('totp-confirm', id, 5);
    const confirmed = await accounts.factors.confirm(request.sessionID, user, id, text(input.code, 6));
    const notificationSent = await accounts.notify(user.email, 'totp_enabled');

    await result(request, response, confirmed.user, { recoveryCodes: confirmed.codes, notificationSent });
  });
  router.delete('/totp', async (request, response) => {
    const user = current(request);
    const updated = await accounts.factors.remove(request.sessionID, user);
    const notificationSent = await accounts.notify(user.email, 'totp_disabled');

    await result(request, response, updated, { notificationSent });
  });
  router.post('/recovery-codes/regenerate', async (request, response) => {
    body(request, []);
    const updated = await accounts.factors.regenerate(request.sessionID, current(request));

    await result(request, response, updated.user, { recoveryCodes: updated.codes });
  });
  for (const reset of [false, true]) {
    const prefix = reset ? '/password/reset' : '/recovery';

    router.post(`${prefix}/request`, async (request, response) => {
      const input = body(request, ['email']);
      const pending = await recovery.request(request.sessionID, normalizeEmail(input.email), reset, request.user);

      response.status(202).json(pending);
    });
    router.post(`${prefix}/${reset ? 'complete' : 'verify'}`, async (request, response) => {
      const input = body(request, reset ? ['flowId', 'code', 'factor', 'password'] : ['flowId', 'code', 'factor']);
      const recovered = await recovery.verify(
        request.sessionID,
        identifier(input.flowId),
        text(input.code, 6),
        input.factor === undefined ? undefined : factor(input.factor),
        reset ? text(input.password) : undefined,
        request.user,
      );
      const user = recovered.user;
      const notificationSent = await accounts.notify(recovered.email, reset ? 'password_reset' : 'recovery_authorized');

      if (!user && !request.user) {
        response.json({ passwordReset: true, notificationSent });
      } else {
        await result(request, response, user, { notificationSent });
      }
    });
  }
  router.post('/recovery/password', async (request, response) => {
    const input = body(request, ['password']);
    const pending = await recovery.password(request.sessionID, current(request), text(input.password));

    response.status(202).json(pending);
  });
  router.post('/recovery/password/complete', async (request, response) => {
    const input = body(request, ['flowId', 'password', 'factor']);
    const user = await recovery.passwordComplete(
      request.sessionID,
      current(request),
      identifier(input.flowId),
      text(input.password),
      factor(input.factor),
    );
    const notificationSent = await accounts.notify(user.email, 'password_recovered');

    await result(request, response, user, { notificationSent });
  });
  router.post('/device-approval/request', async (request, response) => {
    anonymous(request);
    const input = body(request, ['email']);
    const pending = await devices.request(request.sessionID, normalizeEmail(input.email));

    response.status(201).json(pending);
  });
  router.post('/device-approval/status', async (request, response) => {
    const input = body(request, ['requestId']);
    const state = await devices.status(request.sessionID, identifier(input.requestId));

    response.json(state);
  });
  router.post('/device-approval/review', async (request, response) => {
    const input = body(request, ['requestId']);
    const state = await devices.review(request.sessionID, current(request), identifier(input.requestId));

    response.json(state);
  });
  for (const operation of ['approve', 'deny'] as const) {
    router.post(`/device-approval/${operation}`, async (request, response) => {
      const input = body(request, ['requestId', 'userCode']);

      await devices.decide(
        request.sessionID,
        current(request),
        identifier(input.requestId),
        operation === 'approve',
        text(input.userCode, 6),
      );
      response.status(204).end();
    });
  }
  router.post('/device-approval/cancel', async (request, response) => {
    const input = body(request, ['requestId']);

    await devices.cancel(request.sessionID, identifier(input.requestId));
    response.status(204).end();
  });
  router.post('/device-approval/consume', async (request, response) => {
    const input = body(request, ['requestId', 'userCode']);
    const user = await devices.consume(request.sessionID, identifier(input.requestId), text(input.userCode, 6));

    await result(request, response, user);
  });
  router.get('/sessions', async (request, response) => {
    const sessions = await accounts.listSessions(request.sessionID, current(request));

    response.json({ sessions });
  });
  router.delete('/sessions/:id', async (request, response) => {
    const self = await accounts.closeSessions(request.sessionID, current(request), text(request.params.id, 64));

    if (self) {
      response.clearCookie(config.cookieName, { path: '/' });
    }

    response.status(204).end();
  });
  router.post('/sessions/revoke-others', async (request, response) => {
    body(request, []);
    await accounts.closeSessions(request.sessionID, current(request));
    response.status(204).end();
  });

  return router;
}
