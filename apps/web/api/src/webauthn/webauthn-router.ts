import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import { authed, authedContext } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  credentialParamsSchema,
  credentialRegistrationSchema,
  recoveryParamsSchema,
  recoveryRegistrationSchema,
  recoveryUseSchema,
  webAuthnOpenApiPaths,
  webAuthnParamsSchema,
} from './webauthn-schemas';

import { HttpError, httpResponse } from 'shared';
import { getProject } from 'projects';

type CredentialMetadata = {
  accountId: string;
  credentialId: string;
  createdAt: string;
  origin: string;
  prfSupported: boolean;
  rpId: string;
  status: 'active' | 'revoked';
  transports: string[];
  revokedAt?: string;
  workspaceId: string;
};

type RecoveryMetadata = {
  accountId: string;
  enrolledAt: string;
  recoveryId: string;
  status: 'active' | 'used' | 'revoked';
  usedAt?: string;
  revokedAt?: string;
  workspaceId: string;
};

const credentials = new Map<string, CredentialMetadata>();
const recovery = new Map<string, RecoveryMetadata>();
const consumedRecoveryRequests = new Set<string>();

function key(accountId: string, workspaceId: string, id: string): string {
  return `${accountId}\u0000${workspaceId}\u0000${id}`;
}

function assertCanonicalBase64Url(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    throw new HttpError({ code: 'invalid_request', message: 'The request payload is invalid.', statusCode: 400 });
  }
}

async function authorizeWorkspace(req: Parameters<typeof authedContext>[0], workspaceId: string) {
  const context = authedContext(req);

  if (!(await getProject(context, workspaceId))) {
    throw new HttpError({ code: 'workspace_not_found', message: 'The workspace could not be found.', statusCode: 404 });
  }

  return context;
}

function publicCredential(value: CredentialMetadata) {
  const { accountId: _accountId, workspaceId: _workspaceId, ...metadata } = value;

  return metadata;
}

function publicRecovery(value: RecoveryMetadata) {
  const { accountId: _accountId, workspaceId: _workspaceId, ...metadata } = value;

  return metadata;
}

const webAuthnRouter = Router();

webAuthnRouter.use(authed());

webAuthnRouter.get('/:workspaceId/credentials', validateRequest({ params: webAuthnParamsSchema }), async (req, res) => {
  const { workspaceId } = getValidated<{ params: typeof webAuthnParamsSchema }>(req).params!;
  const context = await authorizeWorkspace(req, workspaceId);
  const values = [...credentials.values()]
    .filter((item) => item.accountId === context.accountId && item.workspaceId === workspaceId)
    .map(publicCredential);

  httpResponse.json(res, { data: { credentials: values }, message: 'WebAuthn credential metadata retrieved.' });
});

webAuthnRouter.post(
  '/:workspaceId/credentials',
  validateRequest({ params: webAuthnParamsSchema, body: credentialRegistrationSchema }),
  async (req, res) => {
    const { workspaceId } = getValidated<{ params: typeof webAuthnParamsSchema }>(req).params!;
    const body = getValidated<{ body: typeof credentialRegistrationSchema }>(req).body!;
    const context = await authorizeWorkspace(req, workspaceId);

    assertCanonicalBase64Url(body.credentialId);
    const id = key(context.accountId, workspaceId, body.credentialId);

    if (credentials.has(id)) {
      throw new HttpError({
        code: 'webauthn_credential_conflict',
        message: 'The credential metadata conflicts with existing state.',
        statusCode: 409,
      });
    }
    const value: CredentialMetadata = {
      ...body,
      accountId: context.accountId,
      createdAt: new Date().toISOString(),
      status: 'active',
      workspaceId,
    };

    credentials.set(id, value);
    httpResponse.json(res, {
      data: publicCredential(value),
      status: 201,
      message: 'WebAuthn credential metadata registered.',
    });
  },
);

webAuthnRouter.delete(
  '/:workspaceId/credentials/:credentialId',
  validateRequest({ params: credentialParamsSchema }),
  async (req, res) => {
    const params = getValidated<{ params: typeof credentialParamsSchema }>(req).params!;
    const context = await authorizeWorkspace(req, params.workspaceId);
    const value = credentials.get(key(context.accountId, params.workspaceId, params.credentialId));

    if (!value)
      throw new HttpError({
        code: 'webauthn_metadata_not_found',
        message: 'The requested metadata was not found.',
        statusCode: 404,
      });
    if (value.status === 'active')
      Object.assign(value, { status: 'revoked' as const, revokedAt: new Date().toISOString() });
    httpResponse.json(res, { data: publicCredential(value), message: 'WebAuthn credential metadata revoked.' });
  },
);

webAuthnRouter.get('/:workspaceId/recovery', validateRequest({ params: webAuthnParamsSchema }), async (req, res) => {
  const { workspaceId } = getValidated<{ params: typeof webAuthnParamsSchema }>(req).params!;
  const context = await authorizeWorkspace(req, workspaceId);
  const values = [...recovery.values()]
    .filter((item) => item.accountId === context.accountId && item.workspaceId === workspaceId)
    .map(publicRecovery);

  httpResponse.json(res, { data: { recovery: values }, message: 'WebAuthn recovery metadata retrieved.' });
});

webAuthnRouter.post(
  '/:workspaceId/recovery',
  validateRequest({ params: webAuthnParamsSchema, body: recoveryRegistrationSchema }),
  async (req, res) => {
    const { workspaceId } = getValidated<{ params: typeof webAuthnParamsSchema }>(req).params!;
    const body = getValidated<{ body: typeof recoveryRegistrationSchema }>(req).body!;
    const context = await authorizeWorkspace(req, workspaceId);
    const requestKey = key(context.accountId, workspaceId, body.requestId);

    if (consumedRecoveryRequests.has(requestKey))
      throw new HttpError({
        code: 'webauthn_replay',
        message: 'The recovery operation was already processed.',
        statusCode: 409,
      });
    consumedRecoveryRequests.add(requestKey);
    const value: RecoveryMetadata = {
      accountId: context.accountId,
      enrolledAt: new Date().toISOString(),
      recoveryId: randomUUID(),
      status: 'active',
      workspaceId,
    };

    recovery.set(key(context.accountId, workspaceId, value.recoveryId), value);
    httpResponse.json(res, {
      data: publicRecovery(value),
      status: 201,
      message: 'WebAuthn recovery metadata registered.',
    });
  },
);

webAuthnRouter.delete(
  '/:workspaceId/recovery/:recoveryId',
  validateRequest({ params: recoveryParamsSchema }),
  async (req, res) => {
    const params = getValidated<{ params: typeof recoveryParamsSchema }>(req).params!;
    const context = await authorizeWorkspace(req, params.workspaceId);
    const value = recovery.get(key(context.accountId, params.workspaceId, params.recoveryId));

    if (!value)
      throw new HttpError({
        code: 'webauthn_metadata_not_found',
        message: 'The requested metadata was not found.',
        statusCode: 404,
      });
    if (value.status !== 'revoked')
      Object.assign(value, { status: 'revoked' as const, revokedAt: new Date().toISOString() });
    httpResponse.json(res, { data: publicRecovery(value), message: 'WebAuthn recovery metadata revoked.' });
  },
);

webAuthnRouter.post(
  '/:workspaceId/recovery/:recoveryId/use',
  validateRequest({ params: recoveryParamsSchema, body: recoveryUseSchema }),
  async (req, res) => {
    const params = getValidated<{ params: typeof recoveryParamsSchema }>(req).params!;
    const body = getValidated<{ body: typeof recoveryUseSchema }>(req).body!;
    const context = await authorizeWorkspace(req, params.workspaceId);
    const value = recovery.get(key(context.accountId, params.workspaceId, params.recoveryId));

    if (!value)
      throw new HttpError({
        code: 'webauthn_metadata_not_found',
        message: 'The requested metadata was not found.',
        statusCode: 404,
      });
    const requestKey = key(context.accountId, params.workspaceId, body.requestId);

    if (consumedRecoveryRequests.has(requestKey) || value.status !== 'active')
      throw new HttpError({
        code: 'webauthn_recovery_unavailable',
        message: 'The recovery operation is unavailable.',
        statusCode: 409,
      });
    consumedRecoveryRequests.add(requestKey);
    Object.assign(value, { status: 'used' as const, usedAt: new Date().toISOString() });
    httpResponse.json(res, { data: publicRecovery(value), message: 'WebAuthn recovery metadata marked used.' });
  },
);

function clearWebAuthnMetadata(): void {
  credentials.clear();
  recovery.clear();
  consumedRecoveryRequests.clear();
}

export { clearWebAuthnMetadata, webAuthnOpenApiPaths, webAuthnRouter };
