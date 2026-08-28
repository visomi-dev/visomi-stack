import { errorResponses, responseEnvelope, z } from '../shared/http/route-schemas';

import { encryptedEnvelopeSchema } from 'shared';

const opaqueSyncParamsSchema = z.object({ workspaceId: z.string().min(1).max(200) }).meta({ id: 'OpaqueSyncParams' });
const opaqueSyncQuerySchema = z
  .object({
    afterCursor: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .meta({ id: 'OpaqueSyncQuery' });
const opaqueEnvelopeRequestSchema = z
  .object({
    envelope: encryptedEnvelopeSchema,
    deviceId: z.string().min(1),
    enrollmentVersion: z.number().int().positive(),
  })
  .meta({
    id: 'OpaqueEnvelopeRequest',
    examples: [
      {
        envelope: {
          format: 'themis.encrypted-envelope',
          version: 1,
          kind: 'sync-object',
          envelopeId: 'envelope-1',
          workspaceId: 'workspace-1',
          recordType: 'project-context',
          revision: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          associatedData: {},
          metadata: {},
          nonce: 'bm9uY2U',
          ciphertext: 'Y2lwaGVydGV4dA',
          authTag: 'dGFn',
        },
        deviceId: 'device-1',
        enrollmentVersion: 1,
      },
    ],
  });
const opaqueEnvelopeSchema = z.object({ cursor: z.number().int().positive(), envelope: encryptedEnvelopeSchema });
const opaqueAppendResultSchema = z.object({
  cursor: z.number().int().positive(),
  duplicate: z.boolean(),
  envelope: encryptedEnvelopeSchema,
});
const deviceParamsSchema = z.object({ deviceId: z.string().min(1).max(200) }).meta({ id: 'DeviceParams' });
const deviceRouteParamsSchema = opaqueSyncParamsSchema.merge(deviceParamsSchema);
const deviceCreateSchema = z.object({ publicKey: z.string().min(1), label: z.string().min(1).max(200) });
const deviceApprovalSchema = z.object({ approverDeviceId: z.string().min(1) });
const deviceEnrollmentSchema = z.object({ approverDeviceId: z.string().min(1), envelope: encryptedEnvelopeSchema });
const deviceRecoverySchema = z.object({
  lostDeviceId: z.string().min(1),
  replacementDeviceId: z.string().min(1),
  approverDeviceIds: z.array(z.string().min(1)).min(2).max(5),
  allDeviceLoss: z.boolean().default(false),
  envelope: encryptedEnvelopeSchema,
});
const deviceSyncQuerySchema = z.object({
  deviceId: z.string().min(1),
  enrollmentVersion: z.coerce.number().int().positive(),
});
const checkpointRequestSchema = z
  .object({
    checkpointId: z.string().min(1).max(200),
    cursor: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    envelope: encryptedEnvelopeSchema,
    deviceId: z.string().min(1),
    enrollmentVersion: z.number().int().positive(),
  })
  .meta({ id: 'OpaqueCheckpointRequest' });
const checkpointSchema = z
  .object({
    checkpointId: z.string().min(1),
    cursor: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    envelope: encryptedEnvelopeSchema,
  })
  .meta({ id: 'OpaqueCheckpoint' });
const checkpointParamsSchema = opaqueSyncParamsSchema.extend({ checkpointId: z.string().min(1) });
const recoveryQuerySchema = opaqueSyncQuerySchema
  .merge(deviceSyncQuerySchema)
  .extend({ checkpointId: z.string().min(1) });
const deviceResponseSchema = z.record(z.string(), z.unknown());
const deviceListResponseSchema = z.object({ devices: z.array(deviceResponseSchema) });
const deviceAuditResponseSchema = z.object({ events: z.array(deviceResponseSchema) });

const opaqueSyncOpenApiPaths = {
  '/sync/{workspaceId}/envelopes': {
    get: {
      requestParams: { path: opaqueSyncParamsSchema, query: opaqueSyncQuerySchema.merge(deviceSyncQuerySchema) },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ envelopes: z.array(opaqueEnvelopeSchema) }),
                'OpaqueEnvelopeListEnvelope',
              ),
            },
          },
          description: 'Opaque envelopes.',
        },
      },
    },
    post: {
      requestParams: { path: opaqueSyncParamsSchema },
      requestBody: { content: { 'application/json': { schema: opaqueEnvelopeRequestSchema } } },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': { schema: responseEnvelope(opaqueAppendResultSchema, 'OpaqueAppendResultEnvelope') },
          },
          description: 'Idempotent opaque envelope accepted.',
        },
        201: {
          content: {
            'application/json': {
              schema: responseEnvelope(opaqueAppendResultSchema, 'OpaqueAppendResultCreatedEnvelope'),
            },
          },
          description: 'Opaque envelope accepted.',
        },
      },
    },
  },
  '/sync/{workspaceId}/checkpoints': {
    post: {
      requestParams: { path: opaqueSyncParamsSchema },
      requestBody: { content: { 'application/json': { schema: checkpointRequestSchema } } },
      responses: {
        ...errorResponses,
        201: {
          content: { 'application/json': { schema: responseEnvelope(checkpointSchema, 'OpaqueCheckpointEnvelope') } },
          description: 'Checkpoint stored.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices': {
    get: {
      requestParams: { path: opaqueSyncParamsSchema },
      responses: {
        ...errorResponses,
        200: {
          content: { 'application/json': { schema: responseEnvelope(deviceListResponseSchema, 'DeviceListEnvelope') } },
          description: 'Devices retrieved.',
        },
      },
    },
    post: {
      requestParams: { path: opaqueSyncParamsSchema },
      requestBody: { content: { 'application/json': { schema: deviceCreateSchema } } },
      responses: {
        ...errorResponses,
        200: {
          content: { 'application/json': { schema: responseEnvelope(deviceResponseSchema, 'DeviceCreatedEnvelope') } },
          description: 'Device created.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices/audit': {
    get: {
      requestParams: { path: opaqueSyncParamsSchema },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': { schema: responseEnvelope(deviceAuditResponseSchema, 'DeviceAuditEnvelope') },
          },
          description: 'Device audit events retrieved.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices/{deviceId}/approval': {
    post: {
      requestParams: { path: deviceRouteParamsSchema },
      requestBody: { content: { 'application/json': { schema: deviceApprovalSchema } } },
      responses: {
        ...errorResponses,
        200: {
          content: { 'application/json': { schema: responseEnvelope(deviceResponseSchema, 'DeviceApprovalEnvelope') } },
          description: 'Workspace enrollment approved.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices/{deviceId}/enroll': {
    post: {
      requestParams: { path: deviceRouteParamsSchema },
      requestBody: { content: { 'application/json': { schema: deviceEnrollmentSchema } } },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': { schema: responseEnvelope(deviceResponseSchema, 'DeviceEnrollmentEnvelope') },
          },
          description: 'Device enrolled.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices/{deviceId}/revoke': {
    post: {
      requestParams: { path: deviceRouteParamsSchema },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': { schema: responseEnvelope(deviceResponseSchema, 'DeviceRevocationEnvelope') },
          },
          description: 'Device revoked.',
        },
      },
    },
  },
  '/sync/{workspaceId}/devices/recover': {
    post: {
      requestParams: { path: opaqueSyncParamsSchema },
      requestBody: { content: { 'application/json': { schema: deviceRecoverySchema } } },
      responses: {
        ...errorResponses,
        200: {
          content: { 'application/json': { schema: responseEnvelope(deviceResponseSchema, 'DeviceRecoveryEnvelope') } },
          description: 'Device recovered.',
        },
      },
    },
  },
  '/sync/{workspaceId}/checkpoints/{checkpointId}': {
    get: {
      requestParams: {
        path: checkpointParamsSchema,
        query: deviceSyncQuerySchema,
      },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': { schema: responseEnvelope(checkpointSchema, 'OpaqueCheckpointReadEnvelope') },
          },
          description: 'Checkpoint retrieved.',
        },
      },
    },
  },
  '/sync/{workspaceId}/recovery': {
    get: {
      requestParams: { path: opaqueSyncParamsSchema, query: recoveryQuerySchema },
      responses: {
        ...errorResponses,
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ checkpoint: checkpointSchema, envelopes: z.array(opaqueEnvelopeSchema) }),
                'OpaqueRecoveryEnvelope',
              ),
            },
          },
          description: 'Snapshot and bounded incremental recovery chain.',
        },
      },
    },
  },
};

export {
  opaqueEnvelopeRequestSchema,
  opaqueEnvelopeSchema,
  opaqueSyncOpenApiPaths,
  opaqueSyncParamsSchema,
  opaqueSyncQuerySchema,
  deviceApprovalSchema,
  deviceCreateSchema,
  deviceEnrollmentSchema,
  deviceParamsSchema,
  deviceRouteParamsSchema,
  deviceRecoverySchema,
  deviceSyncQuerySchema,
  checkpointRequestSchema,
  checkpointSchema,
  checkpointParamsSchema,
  recoveryQuerySchema,
};
