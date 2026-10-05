import { z } from '../shared/http/route-schemas';

import { unlockScopeParams } from './contract';

import { browserVaultPairing, browserVaultConsume, browserVaultDelivery } from 'shared-crypto';

export const browserEnrollmentParams = unlockScopeParams.extend({ requestId: z.uuid() }).strict();
export const browserEnrollmentInput = z.strictObject({ pairing: browserVaultPairing });
export const browserApprovalInput = z.strictObject({
  fingerprint: browserVaultPairing.shape.challenge,
  envelope: browserVaultDelivery,
  grantId: z.uuid(),
});
export const browserConsumptionInput = browserVaultConsume;

export const browserEnrollmentPaths = {
  '/vault-unlock/{scopeId}/browser-enrollments': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { required: true, content: { 'application/json': { schema: browserEnrollmentInput } } },
      responses: { 201: { description: 'Ten-minute signed, requester-session-bound pairing; ciphertext only.' } },
    },
  },
  '/vault-unlock/{scopeId}/browser-enrollments/{requestId}': {
    get: {
      requestParams: { path: browserEnrollmentParams },
      responses: { 200: { description: 'Owned pending pairing and status; never the delivery.' } },
    },
    delete: {
      requestParams: { path: browserEnrollmentParams },
      responses: { 204: { description: 'Requester cancellation erases temporary ciphertext.' } },
    },
  },
  '/vault-unlock/{scopeId}/browser-enrollments/{requestId}/approve': {
    post: {
      requestParams: { path: browserEnrollmentParams },
      requestBody: { required: true, content: { 'application/json': { schema: browserApprovalInput } } },
      responses: { 204: { description: 'Purpose-bound approval by another session after matching the fingerprint.' } },
    },
  },
  '/vault-unlock/{scopeId}/browser-enrollments/{requestId}/consume': {
    post: {
      requestParams: { path: browserEnrollmentParams },
      requestBody: { required: true, content: { 'application/json': { schema: browserConsumptionInput } } },
      responses: {
        200: { description: 'Recipient-signed, single-use ciphertext delivery to the original session; relay erased.' },
      },
    },
  },
};
