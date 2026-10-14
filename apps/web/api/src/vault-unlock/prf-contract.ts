import { z } from '../shared/http/route-schemas';

import { unlockScopeParams } from './contract';

import { prfKeyEnvelope } from 'shared-crypto';

// PRF extension output is browser-local secret material, never an API input.
const assertionResponse = z.strictObject({
  id: z.string().min(1).max(1366),
  rawId: z.string().min(1).max(1366),
  type: z.literal('public-key'),
  response: z.strictObject({
    clientDataJSON: z.string().min(1).max(16384),
    authenticatorData: z.string().min(1).max(16384),
    signature: z.string().min(1).max(16384),
    userHandle: z.string().max(1366).nullable().optional(),
  }),
  clientExtensionResults: z.strictObject({}).optional(),
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
});

export const assertionBeginInput = z.discriminatedUnion('purpose', [
  z.strictObject({ purpose: z.literal('enroll'), credentialId: z.string().min(1).max(1366) }),
  z.strictObject({ purpose: z.literal('unlock'), methodId: z.uuid() }),
]);
export const assertionCompleteInput = z.strictObject({ challengeId: z.uuid(), response: assertionResponse });
export const methodCreateInput = z.strictObject({
  methodId: z.uuid(),
  credentialId: z.string().min(1).max(1366),
  envelope: prfKeyEnvelope,
  enrollmentProofId: z.uuid(),
  grantId: z.uuid(),
});
export const unlockMethodParams = unlockScopeParams.extend({ methodId: z.uuid() }).strict();
export const methodDeleteInput = z.strictObject({ expectedRevision: z.number().int().positive(), grantId: z.uuid() });

export const prfUnlockPaths = {
  '/vault-unlock/{scopeId}/methods': {
    get: {
      requestParams: { path: unlockScopeParams },
      responses: { 200: { description: 'Active PRF method metadata; no wrapped keys.' } },
    },
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { required: true, content: { 'application/json': { schema: methodCreateInput } } },
      responses: {
        201: { description: 'Enroll a bound PRF envelope using a fresh verified assertion and management grant.' },
      },
    },
  },
  '/vault-unlock/{scopeId}/methods/{methodId}': {
    delete: {
      requestParams: { path: unlockMethodParams },
      requestBody: { required: true, content: { 'application/json': { schema: methodDeleteInput } } },
      responses: { 204: { description: 'Revision-checked method revocation; downloaded keys cannot be recalled.' } },
    },
  },
  '/vault-unlock/{scopeId}/assertions/begin': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { required: true, content: { 'application/json': { schema: assertionBeginInput } } },
      responses: { 201: { description: 'Session-bound, 60-second UV-required assertion options.' } },
    },
  },
  '/vault-unlock/{scopeId}/assertions/complete': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { required: true, content: { 'application/json': { schema: assertionCompleteInput } } },
      responses: {
        200: { description: 'Single-use verified enrollment proof or encrypted PRF envelope; no PRF output accepted.' },
      },
    },
  },
};
