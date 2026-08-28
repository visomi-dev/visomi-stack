import { Router } from 'express';

import { authed, authedContext } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import {
  createDocumentSchema,
  createProjectSchema,
  projectParamsSchema,
  projectsOpenApiPaths,
  updateProjectSchema,
} from './projects-schemas';
import { listProjectJobs, queueProjectSeed } from './project-seed-queue';

import { HttpError, httpResponse } from 'shared';
import {
  createDocument,
  createProject,
  deleteProject,
  getOperationalWorkspace,
  getProject,
  listProjects,
  updateProject,
} from 'projects';

const projectsRouter = Router();

projectsRouter.use(authed());

projectsRouter.get('/', async function listProjectsHandler(req, res) {
  const projects = await listProjects(authedContext(req));

  httpResponse.json(res, { data: { projects }, message: 'Projects retrieved.' });
});

projectsRouter.get(
  '/:projectId/workspace',
  validateRequest({ params: projectParamsSchema }),
  async function operationalWorkspaceHandler(req, res) {
    const { projectId } = getValidated<{ params: typeof projectParamsSchema }>(req).params!;
    const fixtureHeader = env.ENABLE_TEST_API ? req.get('x-operational-workspace-state') : undefined;
    const lifecycleHeader = env.ENABLE_TEST_API ? req.get('x-operational-workspace-lifecycle') : undefined;
    const httpCase = env.ENABLE_TEST_API ? req.get('x-operational-workspace-http-case') : undefined;

    if (fixtureHeader === 'unauthorized') {
      throw new HttpError({ code: 'unauthorized', message: 'Project access is unavailable.', statusCode: 401 });
    }
    if (httpCase === 'unavailable') {
      throw new HttpError({
        code: 'operational_workspace_unavailable',
        message: 'The operational projection is unavailable.',
        statusCode: 503,
      });
    }
    if (httpCase === 'error') {
      throw new HttpError({
        code: 'operational_workspace_error',
        message: 'The operational projection failed.',
        statusCode: 500,
      });
    }
    if (httpCase === 'malformed-json') {
      res.status(502).type('text/plain').send('{"data":');

      return;
    }
    const fixtureState =
      fixtureHeader &&
      ['visible', 'empty', 'locked', 'unavailable', 'stale', 'error', 'malformed'].includes(fixtureHeader)
        ? (fixtureHeader as Parameters<typeof getOperationalWorkspace>[0]['fixtureState'])
        : undefined;
    const workspace = await getOperationalWorkspace(
      { ...authedContext(req), fixtureState, lifecycle: lifecycleHeader ?? undefined },
      projectId,
    );

    if (!workspace) {
      throw new HttpError({ code: 'project_not_found', message: 'The project could not be found.', statusCode: 404 });
    }

    httpResponse.json(res, { data: workspace, message: 'Operational workspace retrieved.' });
  },
);

projectsRouter.get(
  '/:projectId',
  validateRequest({ params: projectParamsSchema }),
  async function projectDetailHandler(req, res) {
    const { projectId } = getValidated<{ params: typeof projectParamsSchema }>(req).params!;

    const project = await getProject(authedContext(req), projectId);

    if (!project) {
      throw new HttpError({ code: 'project_not_found', message: 'The project could not be found.', statusCode: 404 });
    }

    httpResponse.json(res, { data: project, message: 'Project retrieved.' });
  },
);

projectsRouter.post('/', validateRequest({ body: createProjectSchema }), async function createProjectHandler(req, res) {
  const body = getValidated<{ body: typeof createProjectSchema }>(req).body!;

  const project = await createProject(authedContext(req), body);

  httpResponse.json(res, { data: project, status: 201, message: 'Project created.' });
});

projectsRouter.patch(
  '/:projectId',
  validateRequest({ body: updateProjectSchema, params: projectParamsSchema }),
  async function updateProjectHandler(req, res) {
    const { body, params } = getValidated<{ body: typeof updateProjectSchema; params: typeof projectParamsSchema }>(
      req,
    );

    const project = await updateProject(authedContext(req), params!.projectId, body);

    httpResponse.json(res, { data: project, message: 'Project updated.' });
  },
);

projectsRouter.delete(
  '/:projectId',
  validateRequest({ params: projectParamsSchema }),
  async function deleteProjectHandler(req, res) {
    const { projectId } = getValidated<{ params: typeof projectParamsSchema }>(req).params!;

    await deleteProject(authedContext(req), projectId);

    res.status(204).send();
  },
);

projectsRouter.post(
  '/:projectId/documents',
  validateRequest({ body: createDocumentSchema, params: projectParamsSchema }),
  async function createDocumentHandler(req, res) {
    const { body, params } = getValidated<{ body: typeof createDocumentSchema; params: typeof projectParamsSchema }>(
      req,
    );

    const document = await createDocument(authedContext(req), params!.projectId, body);

    httpResponse.json(res, { data: document, status: 201, message: 'Document created.' });
  },
);

projectsRouter.get(
  '/:projectId/jobs',
  validateRequest({ params: projectParamsSchema }),
  async function projectJobsHandler(req, res) {
    const { projectId } = getValidated<{ params: typeof projectParamsSchema }>(req).params!;

    const jobs = await listProjectJobs(authedContext(req), projectId);

    httpResponse.json(res, { data: { jobs }, message: 'Jobs retrieved.' });
  },
);

projectsRouter.post(
  '/:projectId/seed',
  validateRequest({ params: projectParamsSchema }),
  async function seedProjectHandler(req, res) {
    const { projectId } = getValidated<{ params: typeof projectParamsSchema }>(req).params!;

    const job = await queueProjectSeed(authedContext(req), projectId);

    httpResponse.json(res, { data: job, status: 202, message: 'Project seed queued.' });
  },
);

export { projectsOpenApiPaths, projectsRouter };
