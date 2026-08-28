import { Router } from 'express';

import { authed, authedContext } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  createApiKeySchema,
  milestoneBodySchema,
  apiKeyParamsSchema,
  activationOpenApiPaths,
} from './activation-schemas';
import { createApiKey, getActivationState, recordMilestone, revokeApiKey } from './activation-service';

import { httpResponse } from 'shared';

const activationRouter = Router();

activationRouter.use(authed());

activationRouter.get('/', async function activationStateHandler(req, res) {
  const state = await getActivationState(authedContext(req));

  httpResponse.json(res, { data: state, message: 'Activation state retrieved.' });
});

activationRouter.post(
  '/api-keys',
  validateRequest({ body: createApiKeySchema }),
  async function createApiKeyHandler(req, res) {
    const { label } = getValidated<{ body: typeof createApiKeySchema }>(req).body!;

    const key = await createApiKey(authedContext(req), label);

    httpResponse.json(res, { data: key, status: 201, message: 'API key created.' });
  },
);

activationRouter.post(
  '/milestones',
  validateRequest({ body: milestoneBodySchema }),
  async function milestoneHandler(req, res) {
    const { metadata, milestone } = getValidated<{ body: typeof milestoneBodySchema }>(req).body!;

    await recordMilestone(authedContext(req), milestone, metadata);

    res.status(204).send();
  },
);

activationRouter.post(
  '/api-keys/:apiKeyId/revoke',
  validateRequest({ params: apiKeyParamsSchema }),
  async function revokeApiKeyHandler(req, res) {
    const { apiKeyId } = getValidated<{ params: typeof apiKeyParamsSchema }>(req).params!;

    await revokeApiKey(authedContext(req), apiKeyId);
    res.status(204).send();
  },
);

export { activationOpenApiPaths, activationRouter };
