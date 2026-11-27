import { defineRoute } from '@visomi-stack/web-backend-shared';
import {
  deviceChallengeSchema,
  deviceProofSchema,
  exampleVaultPairingListSchema,
  approvedDeliverySchema,
  keyDomainSchema,
  syncWriteSchema,
  syncReadSchema,
  syncPageSchema,
  syncHeadSchema,
} from '@visomi-stack/shared-db';
import { z } from 'zod';

import { targetSchema } from '../access/contracts';
import { commonErrors, cookieSecurity, csrfSecurity } from '../auth/shared/contracts';

import {
  bootstrapSchema,
  approvalSchema,
  enrollmentRequestSchema,
  revokeDeviceSchema,
  rotateDevicesSchema,
} from './devices';

const params = targetSchema.extend({ domain: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) });
const path = '/tenants/:tenantId/scopes/:scopeId/domains/:domain';
const pairingPath = '/tenants/:tenantId/scopes/:scopeId/domains/private-resources/devices/pairing';
const version = z.number().int().positive();
const state = z.strictObject({ generation: version, epoch: version, phase: z.enum(['ready', 'rotating']).optional() });
const response = (schema: z.ZodType) => ({
  ...commonErrors,
  200: {
    description: 'Authorized protocol result; cloud login does not unwrap client keys.',
    content: { 'application/json': { schema } },
  },
});
const base = {
  tags: ['persistence'],
  security: csrfSecurity,
  description:
    'Opt-in provisional v1. Current scope authority is checked on every operation. No plaintext fallback; PRF and device key possession are separate from cloud authentication.',
};

export const vaultContracts = {
  pairings: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: '/pairing-requests',
    operationId: 'vault_pairing_requests',
    summary: 'Find pending requests for the current account’s Vault Example workspaces',
    request: z.object({}),
    responses: response(exampleVaultPairingListSchema),
  }),
  publishPairing: defineRoute({
    ...base,
    method: 'post',
    path: pairingPath,
    operationId: 'vault_pairing_publish',
    summary: 'Publish a proved Vault Example request for review',
    request: z.object({ params: targetSchema, body: deviceProofSchema }),
    responses: response(deviceProofSchema),
  }),
  readPairing: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${pairingPath}/:id`,
    operationId: 'vault_pairing_read',
    summary: 'Read a currently pending Vault Example request',
    request: z.object({ params: targetSchema.extend({ id: z.uuid() }) }),
    responses: response(deviceProofSchema),
  }),
  request: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/devices/request`,
    operationId: 'vault_device_request',
    summary: 'Issue a five-minute single-use possession challenge',
    request: z.object({ params, body: enrollmentRequestSchema }),
    responses: response(deviceChallengeSchema),
  }),
  bootstrap: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/devices/bootstrap`,
    operationId: 'vault_device_bootstrap',
    summary: 'Initialize an empty key scope with owner possession proof',
    request: z.object({ params, body: bootstrapSchema }),
    responses: response(state),
  }),
  approve: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/devices/approve`,
    operationId: 'vault_device_approve',
    summary: 'Approve a proved recipient with an authorized device signature',
    request: z.object({ params, body: approvalSchema }),
    responses: response(state),
  }),
  roster: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${path}/devices`,
    operationId: 'vault_devices',
    summary: 'Read authorized device public keys and generation',
    request: z.object({ params }),
    responses: response(
      z.strictObject({
        key: keyDomainSchema,
        epoch: version,
        phase: z.enum(['ready', 'rotating']),
        objectBackup: z.literal(true).optional(),
        devices: z.array(
          z.strictObject({
            id: z.uuid(),
            ownerId: z.uuid(),
            signing: z.string(),
            encryption: z.string(),
            revokedAt: z.string().nullable(),
          }),
        ),
      }),
    ),
  }),
  delivery: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${path}/devices/:id/delivery`,
    operationId: 'vault_device_delivery',
    summary: 'Read an active device delivery for its current owner',
    request: z.object({ params: params.extend({ id: z.uuid() }) }),
    responses: response(approvedDeliverySchema),
  }),
  revoke: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/devices/revoke`,
    operationId: 'vault_device_revoke',
    summary: 'Revoke a device and block writes until rotation commits',
    request: z.object({ params, body: revokeDeviceSchema }),
    responses: response(state),
  }),
  rotate: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/devices/rotate`,
    operationId: 'vault_device_rotate',
    summary: 'Atomically install a generation for every remaining active device',
    request: z.object({ params, body: rotateDevicesSchema }),
    responses: response(state),
  }),
  pull: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/sync/pull`,
    operationId: 'vault_sync_pull',
    summary: 'Read a bounded ciphertext event page after a pinned checkpoint',
    request: z.object({ params, body: syncReadSchema }),
    responses: response(syncPageSchema),
  }),
  push: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/sync/push`,
    operationId: 'vault_sync_push',
    summary: 'Commit signed ciphertext with revision, cursor and generation barriers',
    request: z.object({ params, body: syncWriteSchema }),
    responses: response(syncHeadSchema),
  }),
};
