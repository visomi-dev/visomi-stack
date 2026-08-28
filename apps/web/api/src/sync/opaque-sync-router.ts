import { Router, type NextFunction } from 'express';

import { authed, authedContext } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  deviceApprovalSchema,
  deviceCreateSchema,
  deviceEnrollmentSchema,
  deviceRouteParamsSchema,
  deviceRecoverySchema,
  deviceSyncQuerySchema,
  checkpointRequestSchema,
  recoveryQuerySchema,
  checkpointSchema,
  checkpointParamsSchema,
  opaqueEnvelopeRequestSchema,
  opaqueSyncOpenApiPaths,
  opaqueSyncParamsSchema,
  opaqueSyncQuerySchema,
} from './opaque-sync-schemas';

import {
  DeviceIdentityError,
  HttpError,
  httpResponse,
  opaqueSyncStore,
  deviceIdentityStore,
  env,
  getConfiguredOpaqueSyncRepository,
  getConfiguredDeviceIdentityStore,
} from 'shared';
import { getProject } from 'projects';

const opaqueSyncRouter = Router();
const deviceStore = () =>
  env.OPAQUE_SYNC_STORAGE === 'durable' ? getConfiguredDeviceIdentityStore() : deviceIdentityStore;

async function authorizeWorkspace(req: Parameters<typeof authedContext>[0], workspaceId: string) {
  const context = authedContext(req);
  const workspace = await getProject(context, workspaceId);

  if (!workspace) {
    throw new HttpError({
      code: 'workspace_not_found',
      message: 'The workspace could not be found.',
      statusCode: 404,
    });
  }

  return context;
}

function nextDeviceError(next: NextFunction, error: unknown): void {
  next(
    new HttpError({
      code: 'device_lifecycle_rejected',
      message: error instanceof DeviceIdentityError ? error.message : 'The device operation was rejected.',
      statusCode: 409,
    }),
  );
}

opaqueSyncRouter.use(authed());

opaqueSyncRouter.post(
  '/:workspaceId/devices',
  validateRequest({ body: deviceCreateSchema, params: opaqueSyncParamsSchema }),
  async function createDevice(req, res, next) {
    const { params, body } = getValidated<{ params: typeof opaqueSyncParamsSchema; body: typeof deviceCreateSchema }>(
      req,
    );
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      httpResponse.json(res, {
        data: await deviceStore().createIdentity(
          context.accountId,
          body!.publicKey,
          body!.label,
          new Date(),
          params!.workspaceId,
        ),
        message: 'Device created.',
      });
    } catch (error) {
      nextDeviceError(next, error);
    }
  },
);

opaqueSyncRouter.get(
  '/:workspaceId/devices',
  validateRequest({ params: opaqueSyncParamsSchema }),
  async function listDevices(req, res) {
    const { params } = getValidated<{ params: typeof opaqueSyncParamsSchema }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    httpResponse.json(res, {
      data: { devices: await deviceStore().listDevices(context.accountId) },
      message: 'Devices retrieved.',
    });
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/checkpoints',
  validateRequest({ body: checkpointRequestSchema, params: opaqueSyncParamsSchema }),
  async function createCheckpoint(req, res, next) {
    const { params, body } = getValidated<{
      params: typeof opaqueSyncParamsSchema;
      body: typeof checkpointRequestSchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      await deviceStore().authorizeSync(
        context.accountId,
        body!.deviceId,
        params!.workspaceId,
        body!.enrollmentVersion,
      );
      const checkpoint =
        env.OPAQUE_SYNC_STORAGE === 'durable'
          ? await getConfiguredOpaqueSyncRepository().createCheckpoint(
              context.accountId,
              params!.workspaceId,
              body!.checkpointId,
              body!.cursor,
              body!.revision,
              body!.envelope,
            )
          : opaqueSyncStore.checkpoint(
              context.accountId,
              params!.workspaceId,
              body!.checkpointId,
              body!.cursor,
              body!.revision,
              body!.envelope,
            );

      httpResponse.json(res, { data: checkpoint, status: 201, message: 'Checkpoint stored.' });
    } catch {
      next(new HttpError({ code: 'checkpoint_rejected', message: 'The checkpoint was rejected.', statusCode: 409 }));
    }
  },
);

opaqueSyncRouter.get(
  '/:workspaceId/checkpoints/:checkpointId',
  validateRequest({
    params: opaqueSyncParamsSchema.extend({ checkpointId: checkpointSchema.shape.checkpointId }),
    query: deviceSyncQuerySchema,
  }),
  async function getCheckpoint(req, res, next) {
    const { params, query } = getValidated<{
      params: typeof checkpointParamsSchema;
      query: typeof deviceSyncQuerySchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      await deviceStore().authorizeSync(
        context.accountId,
        query!.deviceId,
        params!.workspaceId,
        query!.enrollmentVersion,
      );
      const checkpoint =
        env.OPAQUE_SYNC_STORAGE === 'durable'
          ? await getConfiguredOpaqueSyncRepository().getCheckpoint(
              context.accountId,
              params!.workspaceId,
              params!.checkpointId,
            )
          : opaqueSyncStore.getCheckpoint(context.accountId, params!.workspaceId, params!.checkpointId);

      httpResponse.json(res, { data: checkpoint, message: 'Checkpoint retrieved.' });
    } catch {
      next(
        new HttpError({
          code: 'checkpoint_not_found',
          message: 'The checkpoint could not be retrieved.',
          statusCode: 404,
        }),
      );
    }
  },
);

opaqueSyncRouter.get(
  '/:workspaceId/recovery',
  validateRequest({ params: opaqueSyncParamsSchema, query: recoveryQuerySchema }),
  async function recoverStream(req, res, next) {
    const { params, query } = getValidated<{
      params: typeof opaqueSyncParamsSchema;
      query: typeof recoveryQuerySchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      await deviceStore().authorizeSync(
        context.accountId,
        query!.deviceId,
        params!.workspaceId,
        query!.enrollmentVersion,
      );
      const recovery =
        env.OPAQUE_SYNC_STORAGE === 'durable'
          ? await getConfiguredOpaqueSyncRepository().recovery(
              context.accountId,
              params!.workspaceId,
              query!.checkpointId,
              query!.afterCursor,
              query!.limit,
            )
          : opaqueSyncStore.recovery(
              context.accountId,
              params!.workspaceId,
              query!.checkpointId,
              query!.afterCursor,
              query!.limit,
            );

      httpResponse.json(res, { data: recovery, message: 'Recovery chain retrieved.' });
    } catch {
      next(
        new HttpError({
          code: 'recovery_chain_unavailable',
          message: 'The recovery chain could not be retrieved.',
          statusCode: 409,
        }),
      );
    }
  },
);

opaqueSyncRouter.get(
  '/:workspaceId/devices/audit',
  validateRequest({ params: opaqueSyncParamsSchema }),
  async function listDeviceAudit(req, res) {
    const { params } = getValidated<{ params: typeof opaqueSyncParamsSchema }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    httpResponse.json(res, {
      data: {
        events: (await deviceStore().auditEvents(context.accountId)).filter(
          (event) => event.workspaceId === params!.workspaceId,
        ),
      },
      message: 'Device audit events retrieved.',
    });
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/devices/:deviceId/approval',
  validateRequest({ body: deviceApprovalSchema, params: deviceRouteParamsSchema }),
  async function approveWorkspace(req, res, next) {
    const { params, body } = getValidated<{
      params: typeof deviceRouteParamsSchema;
      body: typeof deviceApprovalSchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      if (params!.deviceId !== body!.approverDeviceId) {
        throw new DeviceIdentityError('Approval device does not match the route.');
      }
      await deviceStore().approveWorkspace(context.accountId, params!.workspaceId, params!.deviceId);
      httpResponse.json(res, {
        data: { workspaceId: params!.workspaceId, approvedByDeviceId: body!.approverDeviceId },
        message: 'Workspace enrollment approved.',
      });
    } catch (error) {
      nextDeviceError(next, error);
    }
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/devices/:deviceId/enroll',
  validateRequest({ body: deviceEnrollmentSchema, params: deviceRouteParamsSchema }),
  async function enrollDevice(req, res, next) {
    const { params, body } = getValidated<{
      params: typeof deviceRouteParamsSchema;
      body: typeof deviceEnrollmentSchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      httpResponse.json(res, {
        data: await deviceStore().enrollDevice(
          context.accountId,
          params!.deviceId,
          params!.workspaceId,
          body!.approverDeviceId,
          body!.envelope,
        ),
        message: 'Device enrolled.',
      });
    } catch (error) {
      nextDeviceError(next, error);
    }
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/devices/:deviceId/revoke',
  validateRequest({ params: deviceRouteParamsSchema }),
  async function revokeDevice(req, res, next) {
    const { params } = getValidated<{ params: typeof deviceRouteParamsSchema }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      await deviceStore().revokeDevice(context.accountId, params!.deviceId, new Date(), params!.workspaceId);
      httpResponse.json(res, { data: { deviceId: params!.deviceId, status: 'revoked' }, message: 'Device revoked.' });
    } catch (error) {
      nextDeviceError(next, error);
    }
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/devices/recover',
  validateRequest({ body: deviceRecoverySchema, params: opaqueSyncParamsSchema }),
  async function recoverDevice(req, res, next) {
    const { params, body } = getValidated<{ params: typeof opaqueSyncParamsSchema; body: typeof deviceRecoverySchema }>(
      req,
    );
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      httpResponse.json(res, {
        data: await deviceStore().recoverDevice(
          context.accountId,
          body!.lostDeviceId,
          body!.replacementDeviceId,
          params!.workspaceId,
          body!.approverDeviceIds[0],
          body!.envelope,
          new Date(),
          body!.approverDeviceIds,
          body!.allDeviceLoss,
        ),
        message: 'Device recovered.',
      });
    } catch (error) {
      nextDeviceError(next, error);
    }
  },
);

opaqueSyncRouter.post(
  '/:workspaceId/envelopes',
  validateRequest({ body: opaqueEnvelopeRequestSchema, params: opaqueSyncParamsSchema }),
  async function appendOpaqueEnvelopeHandler(req, res, next) {
    const { params } = getValidated<{ params: typeof opaqueSyncParamsSchema }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      const { body, params } = getValidated<{
        body: typeof opaqueEnvelopeRequestSchema;
        params: typeof opaqueSyncParamsSchema;
      }>(req);

      await deviceStore().authorizeSync(
        context.accountId,
        body!.deviceId,
        params!.workspaceId,
        body!.enrollmentVersion,
      );
      const result =
        env.OPAQUE_SYNC_STORAGE === 'durable'
          ? await getConfiguredOpaqueSyncRepository().append(context.accountId, params!.workspaceId, body!.envelope)
          : opaqueSyncStore.append(context.accountId, params!.workspaceId, body!.envelope);

      httpResponse.json(res, { data: result, status: result.duplicate ? 200 : 201, message: 'Envelope accepted.' });
    } catch {
      next(
        new HttpError({
          code: 'opaque_envelope_rejected',
          message: 'The encrypted envelope was rejected.',
          statusCode: 409,
        }),
      );
    }
  },
);

opaqueSyncRouter.get(
  '/:workspaceId/envelopes',
  validateRequest({ params: opaqueSyncParamsSchema, query: opaqueSyncQuerySchema.merge(deviceSyncQuerySchema) }),
  async function listOpaqueEnvelopesHandler(req, res, next) {
    const { params, query } = getValidated<{
      params: typeof opaqueSyncParamsSchema;
      query: typeof opaqueSyncQuerySchema & typeof deviceSyncQuerySchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);

    try {
      await deviceStore().authorizeSync(
        context.accountId,
        query!.deviceId,
        params!.workspaceId,
        query!.enrollmentVersion,
      );
    } catch (error) {
      nextDeviceError(next, error);

      return;
    }
    try {
      const envelopes =
        env.OPAQUE_SYNC_STORAGE === 'durable'
          ? await getConfiguredOpaqueSyncRepository().list(
              context.accountId,
              params!.workspaceId,
              query!.afterCursor,
              query!.limit,
            )
          : opaqueSyncStore.list(context.accountId, params!.workspaceId, query!.afterCursor, query!.limit);

      httpResponse.json(res, { data: { envelopes }, message: 'Envelopes retrieved.' });
    } catch {
      next(
        new HttpError({
          code: 'cursor_recovery_required',
          message: 'The requested cursor requires snapshot recovery.',
          statusCode: 409,
        }),
      );
    }
  },
);

export { opaqueSyncOpenApiPaths, opaqueSyncRouter };
