import { Router } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { getValidated, responseEnvelope, validateRequest, z } from '../shared/http/route-schemas';

import { HttpError, httpResponse, operationEvent, readOperation } from 'shared';

const params = z.strictObject({ operationId: z.uuid() });

export const operationRouter = Router();

operationRouter.use(
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
  authed({ authority: 'full' }),
);
operationRouter.get('/:operationId', validateRequest({ params }), async (req, res) => {
  const { operationId } = getValidated<{ params: typeof params }>(req).params!;
  const { user } = authedRequest(req);
  const event = await readOperation(operationId, {
    sessionId: req.sessionID,
    userId: user.id,
    accountId: user.accountId,
    authVersion: user.authVersion ?? 1,
  });

  if (!event)
    throw new HttpError({ code: 'operation_not_found', message: 'The operation is unavailable.', statusCode: 404 });
  httpResponse.json(res, { data: event, message: 'Operation retrieved.' });
});

export const operationPaths = {
  '/operations/{operationId}': {
    get: {
      requestParams: { path: params },
      responses: {
        200: {
          description: 'Session-bound operation status and bounded routing metadata.',
          content: { 'application/json': { schema: responseEnvelope(operationEvent, 'OperationEnvelope') } },
        },
      },
    },
  },
};
