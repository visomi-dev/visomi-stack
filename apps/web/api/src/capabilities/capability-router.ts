import { createHmac, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

import { Router } from 'express';

import { authed, authedContext } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { capabilityOpenApiPaths, capabilityParamsSchema, modeNegotiationRequestSchema } from './capability-schemas';

import {
  CLIENT_CAPABILITY_VERSION,
  ClientCapabilityContractError,
  capabilitiesForMode,
  negotiateClientMode,
  type ClientCapabilityClaim,
  type ModeNegotiationRequest,
} from 'shared';
import { HttpError, deviceIdentityStore, env, getConfiguredDeviceIdentityStore, httpResponse } from 'shared';
import { getProject } from 'projects';

const capabilityRouter = Router();
const consumedClaims = new Map<string, number>();
const consumedRequests = new Map<string, number>();

const profiles = [
  {
    profile: 'web-local-agent' as const,
    modes: ['local-agent', 'webcrypto'] as const,
    capabilities: {
      'local-agent': capabilitiesForMode('local-agent'),
      webcrypto: capabilitiesForMode('webcrypto'),
    },
  },
  {
    profile: 'web-webcrypto' as const,
    modes: ['webcrypto'] as const,
    capabilities: { webcrypto: capabilitiesForMode('webcrypto') },
  },
];

function expireReplayEntries(now: number): void {
  for (const [key, expiresAt] of consumedClaims) if (expiresAt <= now) consumedClaims.delete(key);
  for (const [key, expiresAt] of consumedRequests) if (expiresAt <= now) consumedRequests.delete(key);
}

function rejectNegotiation(error: unknown): never {
  const code = error instanceof ClientCapabilityContractError ? error.code : 'malformed';
  const statusCode = code === 'unauthenticated' ? 401 : code === 'malformed' ? 400 : 409;

  throw new HttpError({
    code: `capability_${code}`,
    message: 'The capability negotiation request was rejected.',
    statusCode,
  });
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function authenticatorMessage(claim: ClientCapabilityClaim): Buffer {
  const unsignedClaim = {
    ...claim,
    authenticator: { ...claim.authenticator, proof: '' },
  };

  return Buffer.from(canonicalize(unsignedClaim));
}

function decodeProof(proof: string, prefix: string): Buffer | undefined {
  if (!proof.startsWith(prefix)) return undefined;
  const encoded = proof.slice(prefix.length);

  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;

  const decoded = Buffer.from(encoded, 'base64url');

  // Reject alternate encodings whose unused trailing bits decode to the same
  // bytes. The proof string is part of the signed claim boundary and must
  // have one canonical representation on the wire.
  return decoded.toString('base64url') === encoded ? decoded : undefined;
}

function createWebSessionProof(claim: ClientCapabilityClaim): string {
  return `hmac-sha256:${createHmac('sha256', env.SESSION_SECRET).update(authenticatorMessage(claim)).digest('base64url')}`;
}

function verifyWebSessionProof(claim: ClientCapabilityClaim): boolean {
  const expected = createHmac('sha256', env.SESSION_SECRET).update(authenticatorMessage(claim)).digest();
  const provided = decodeProof(claim.authenticator.proof, 'hmac-sha256:');

  return Boolean(provided && provided.length === expected.length && timingSafeEqual(provided, expected));
}

async function verifyLocalAgentProof(claim: ClientCapabilityClaim, accountId: string): Promise<boolean> {
  try {
    const store = env.OPAQUE_SYNC_STORAGE === 'durable' ? getConfiguredDeviceIdentityStore() : deviceIdentityStore;

    await store.authorizeLocalAgent(accountId, claim.clientId, claim.workspaceId);
    const signature = decodeProof(claim.authenticator.proof, 'ed25519:');

    if (!signature) return false;

    const devices = await store.listDevices(accountId);
    const device = devices.find(({ deviceId }) => deviceId === claim.clientId);

    if (!device) return false;

    return verify(null, authenticatorMessage(claim), createPublicKey(device.publicKey), signature);
  } catch {
    return false;
  }
}

function createLocalAgentProof(claim: ClientCapabilityClaim, privateKey: KeyObject): string {
  return `ed25519:${sign(null, authenticatorMessage(claim), privateKey).toString('base64url')}`;
}

async function authorizeWorkspace(req: Parameters<typeof authedContext>[0], workspaceId: string) {
  const context = authedContext(req);

  if (!(await getProject(context, workspaceId))) {
    throw new HttpError({ code: 'workspace_not_found', message: 'The workspace could not be found.', statusCode: 404 });
  }

  return context;
}

capabilityRouter.use(authed());

capabilityRouter.get(
  '/:workspaceId',
  validateRequest({ params: capabilityParamsSchema }),
  async function discoveryHandler(req, res) {
    const { workspaceId } = getValidated<{ params: typeof capabilityParamsSchema }>(req).params!;

    await authorizeWorkspace(req, workspaceId);

    httpResponse.json(res, {
      data: { version: CLIENT_CAPABILITY_VERSION, profiles },
      message: 'Capability profiles retrieved.',
    });
  },
);

capabilityRouter.post(
  '/:workspaceId',
  validateRequest({ body: modeNegotiationRequestSchema, params: capabilityParamsSchema }),
  async function negotiationHandler(req, res) {
    const { body, params } = getValidated<{
      body: typeof modeNegotiationRequestSchema;
      params: typeof capabilityParamsSchema;
    }>(req);
    const context = await authorizeWorkspace(req, params!.workspaceId);
    const request = body! as ModeNegotiationRequest;
    const now = Date.now();

    expireReplayEntries(now);

    try {
      const claim = request.claim as ClientCapabilityClaim;

      if (claim.accountId !== context.accountId || claim.workspaceId !== params!.workspaceId) {
        throw new ClientCapabilityContractError(
          'ambiguous-identity',
          'Capability claim scope does not match the session.',
        );
      }
      if (
        (claim.authenticator.scheme !== 'web-session' && claim.authenticator.scheme !== 'local-agent-signature') ||
        (claim.authenticator.scheme === 'web-session' && claim.authenticator.keyId !== context.userId) ||
        (claim.authenticator.scheme === 'local-agent-signature' && claim.authenticator.keyId !== claim.clientId)
      ) {
        throw new ClientCapabilityContractError('unauthenticated', 'Capability claim authentication failed.');
      }
      if (!request.requestedCapabilities.every((capability) => claim.capabilities.includes(capability))) {
        throw new ClientCapabilityContractError('unsupported-capability', 'Capability claim scope is invalid.');
      }
      if (consumedClaims.has(claim.claimId) || consumedRequests.has(request.requestId)) {
        throw new ClientCapabilityContractError('unavailable', 'Capability claim has already been consumed.');
      }

      const localAgentProofValid =
        claim.authenticator.scheme === 'local-agent-signature'
          ? await verifyLocalAgentProof(claim, context.accountId)
          : undefined;

      const negotiated = negotiateClientMode(
        request,
        (candidate) =>
          candidate.authenticator.scheme === 'web-session'
            ? verifyWebSessionProof(candidate)
            : candidate.claimId === claim.claimId && localAgentProofValid === true,
        now,
      );

      consumedClaims.set(claim.claimId, Date.parse(claim.expiresAt));
      consumedRequests.set(request.requestId, Date.parse(claim.expiresAt));
      httpResponse.json(res, { data: negotiated, message: 'Client mode negotiated.' });
    } catch (error) {
      rejectNegotiation(error);
    }
  },
);

export { capabilityOpenApiPaths, capabilityRouter, createLocalAgentProof, createWebSessionProof };
