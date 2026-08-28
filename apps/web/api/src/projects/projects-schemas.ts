import { projectIdParamSchema, responseEnvelope, z } from '../shared/http/route-schemas';

import { errorEnvelopeSchema } from 'shared';

export const projectStatusSchema = z.enum(['active', 'archived', 'draft']);
export const projectSourceTypeSchema = z.enum(['imported', 'manual', 'seeded']);
export const documentStatusSchema = z.enum(['active', 'archived', 'draft']);
export const documentTypeSchema = z.enum([
  'architecture',
  'brief',
  'imported_reference',
  'operational_notes',
  'overview',
  'setup',
]);

export const projectSchema = z
  .object({
    accountId: z.string(),
    createdAt: z.string(),
    createdByUserId: z.string(),
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    sourceType: projectSourceTypeSchema,
    status: projectStatusSchema,
    summary: z.string().nullable(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Project' });

export const projectDocumentSchema = z
  .object({
    contentMarkdown: z.string(),
    createdAt: z.string(),
    createdByUserId: z.string(),
    documentType: documentTypeSchema,
    id: z.string(),
    projectId: z.string(),
    source: z.string(),
    status: documentStatusSchema,
    title: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'ProjectDocument' });

export const asyncJobSchema = z
  .object({
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    errorMessage: z.string().nullable(),
    id: z.string(),
    progress: z.number(),
    projectId: z.string().nullable(),
    resultJson: z.string().nullable(),
    status: z.enum(['completed', 'failed', 'queued', 'running']),
    type: z.enum(['project_seed']),
    updatedAt: z.string(),
    userId: z.string(),
  })
  .meta({ id: 'AsyncJob' });

export const projectWithDocumentsSchema = projectSchema
  .extend({
    documents: z.array(projectDocumentSchema),
    jobs: z.array(asyncJobSchema),
  })
  .meta({ id: 'ProjectWithDocuments' });

export const projectParamsSchema = z.object({ projectId: projectIdParamSchema }).meta({ id: 'ProjectParams' });

export const createProjectSchema = z
  .object({
    name: z.string().min(1).max(120),
    sourceType: projectSourceTypeSchema.optional(),
    summary: z.string().max(500).optional(),
  })
  .meta({ id: 'CreateProjectRequest' });

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: projectStatusSchema.optional(),
    summary: z.string().nullable().optional(),
  })
  .meta({ id: 'UpdateProjectRequest' });

export const createDocumentSchema = z
  .object({
    contentMarkdown: z.string(),
    documentType: documentTypeSchema,
    source: z.string().optional(),
    status: documentStatusSchema.optional(),
    title: z.string().min(1),
  })
  .meta({ id: 'CreateProjectDocumentRequest' });

export const projectsListSchema = z
  .object({
    projects: z.array(projectSchema),
  })
  .meta({ id: 'ProjectsListResponse' });

const operationalVisibilitySchema = z.enum([
  'visible',
  'empty',
  'locked',
  'unavailable',
  'stale',
  'error',
  'unauthorized',
  'malformed',
]);
const operationalAuthoritySchema = z.enum(['control-plane', 'local-agent', 'opaque-encrypted-source']);
const operationalCollectionBaseSchema = z.object({
  authority: operationalAuthoritySchema,
  state: operationalVisibilitySchema,
  source: z.string(),
  observedAt: z.string(),
  reason: z.string().optional(),
});
const operationalEpicSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  status: z.enum(['active', 'closed']),
});
const operationalWorkItemSchema = z.object({
  id: z.string(),
  epicId: z.string().nullable(),
  title: z.string(),
  status: z.enum(['draft', 'ready', 'in_progress', 'review', 'blocked', 'done']),
  updatedAt: z.string(),
});
const operationalRunSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
const operationalEvidenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum(['verification', 'implementation-diff', 'observation', 'command']),
  createdAt: z.string(),
});
const operationalReviewSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  verdict: z.enum(['accepted', 'rejected', 'pending']),
  createdAt: z.string(),
});
const operationalActivitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(['status', 'progress', 'run', 'review']),
  occurredAt: z.string(),
  summary: z.string(),
});
const operationalContextSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(['description', 'decision', 'note']),
  value: z.string(),
});
const operationalCollection = <T extends z.ZodType>(item: T) =>
  operationalCollectionBaseSchema.extend({ items: z.array(item) });
const operationalProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: projectStatusSchema,
  visibility: z.literal('operational'),
  updatedAt: z.string(),
});

export const operationalWorkspaceSchema = z
  .object({
    schemaVersion: z.literal('1'),
    readOnly: z.literal(true),
    project: operationalCollection(operationalProjectSchema),
    protectedContext: operationalCollection(operationalContextSchema),
    epics: operationalCollection(operationalEpicSchema),
    workItems: operationalCollection(operationalWorkItemSchema),
    runs: operationalCollection(operationalRunSchema),
    evidence: operationalCollection(operationalEvidenceSchema),
    reviews: operationalCollection(operationalReviewSchema),
    activity: operationalCollection(operationalActivitySchema),
  })
  .meta({ id: 'OperationalWorkspaceReadModelV1' });

export const operationalWorkspaceErrorSchema = errorEnvelopeSchema.meta({ id: 'OperationalWorkspaceErrorEnvelope' });

export const jobsListSchema = z
  .object({
    jobs: z.array(asyncJobSchema),
  })
  .meta({ id: 'ProjectJobsResponse' });

export const projectsOpenApiPaths = {
  '/projects': {
    get: {
      responses: {
        200: {
          content: { 'application/json': { schema: responseEnvelope(projectsListSchema, 'ProjectsListEnvelope') } },
          description: 'List account projects.',
        },
      },
    },
    post: {
      requestBody: { content: { 'application/json': { schema: createProjectSchema } } },
      responses: {
        201: {
          content: { 'application/json': { schema: responseEnvelope(projectSchema, 'ProjectEnvelope') } },
          description: 'Project created.',
        },
      },
    },
  },
  '/projects/{projectId}': {
    get: {
      requestParams: { path: projectParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(projectWithDocumentsSchema, 'ProjectWithDocumentsEnvelope'),
            },
          },
          description: 'Project detail.',
        },
      },
    },
    patch: {
      requestParams: { path: projectParamsSchema },
      requestBody: { content: { 'application/json': { schema: updateProjectSchema } } },
      responses: {
        200: {
          content: { 'application/json': { schema: responseEnvelope(projectSchema, 'UpdatedProjectEnvelope') } },
          description: 'Project updated.',
        },
      },
    },
    delete: {
      requestParams: { path: projectParamsSchema },
      responses: { 204: { description: 'Project deleted.' } },
    },
  },
  '/projects/{projectId}/workspace': {
    get: {
      requestParams: { path: projectParamsSchema },
      parameters: [
        {
          in: 'header' as const,
          name: 'x-operational-workspace-state',
          required: false,
          schema: {
            type: 'string' as const,
            enum: ['visible', 'empty', 'locked', 'unavailable', 'stale', 'error', 'malformed', 'unauthorized'],
          },
        },
        {
          in: 'header' as const,
          name: 'x-operational-workspace-http-case',
          required: false,
          schema: {
            type: 'string' as const,
            enum: ['unavailable', 'error', 'malformed-json'],
          },
        },
      ],
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(operationalWorkspaceSchema, 'OperationalWorkspaceEnvelope'),
            },
          },
          description: 'Versioned, read-only operational workspace projection.',
        },
        401: {
          content: { 'application/json': { schema: operationalWorkspaceErrorSchema } },
          description: 'The caller is not authenticated or the projection is unauthorized.',
        },
        404: {
          content: { 'application/json': { schema: operationalWorkspaceErrorSchema } },
          description: 'The project is not found in the authenticated tenant.',
        },
        500: {
          content: { 'application/json': { schema: operationalWorkspaceErrorSchema } },
          description: 'The projection failed while reading the protected boundary.',
        },
        502: {
          content: { 'text/plain': { schema: { type: 'string' as const } } },
          description: 'The mediated boundary returned malformed JSON.',
        },
        503: {
          content: { 'application/json': { schema: operationalWorkspaceErrorSchema } },
          description: 'The mediated projection is temporarily unavailable.',
        },
      },
    },
  },
  '/projects/{projectId}/documents': {
    post: {
      requestParams: { path: projectParamsSchema },
      requestBody: { content: { 'application/json': { schema: createDocumentSchema } } },
      responses: {
        201: {
          content: {
            'application/json': { schema: responseEnvelope(projectDocumentSchema, 'ProjectDocumentEnvelope') },
          },
          description: 'Project document created.',
        },
      },
    },
  },
  '/projects/{projectId}/jobs': {
    get: {
      requestParams: { path: projectParamsSchema },
      responses: {
        200: {
          content: { 'application/json': { schema: responseEnvelope(jobsListSchema, 'ProjectJobsEnvelope') } },
          description: 'Project jobs.',
        },
      },
    },
  },
  '/projects/{projectId}/seed': {
    post: {
      requestParams: { path: projectParamsSchema },
      responses: {
        202: {
          content: { 'application/json': { schema: responseEnvelope(asyncJobSchema, 'AsyncJobEnvelope') } },
          description: 'Project seed queued.',
        },
      },
    },
  },
};
