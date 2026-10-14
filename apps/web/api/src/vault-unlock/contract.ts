import { z } from '../shared/http/route-schemas';

import { vaultPinProfile } from 'shared-crypto';

export const unlockScopeParams = z.strictObject({ scopeId: z.uuid() });
export const localPinInput = z.strictObject({
  grantId: z.uuid(),
  expectedMethodId: z.uuid().nullable(),
  profile: vaultPinProfile.optional(),
});
export const pinAttemptInput = z.strictObject({ methodId: z.uuid() });
export const recoveryExportInput = z.strictObject({ grantId: z.uuid() });
export const localPinDeleteInput = z.strictObject({ grantId: z.uuid(), expectedMethodId: z.uuid() });

export const vaultUnlockPaths = {
  '/vault-unlock/{scopeId}/config': {
    get: {
      requestParams: { path: unlockScopeParams },
      responses: { 200: { description: 'Available native methods and the current canonical PIN method ID.' } },
    },
  },
  '/vault-unlock/{scopeId}/pin-profile': {
    get: {
      requestParams: { path: unlockScopeParams },
      responses: { 200: { description: 'DEK-encrypted canonical PIN profile only; never a PIN-wrapped key.' } },
    },
  },
  '/vault-unlock/{scopeId}/pin-attempt': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { content: { 'application/json': { schema: pinAttemptInput } } },
      responses: {
        200: { description: 'Consume one shared attempt before local derivation.' },
        429: { description: 'Five attempts per ten-minute window, shared by all sessions/devices.' },
      },
    },
  },
  '/vault-unlock/{scopeId}/local-method': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { content: { 'application/json': { schema: localPinInput } } },
      responses: { 200: { description: 'Purpose-bound profile compare-and-swap or authorize local enrollment.' } },
    },
    delete: {
      requestParams: { path: unlockScopeParams },
      requestBody: { content: { 'application/json': { schema: localPinDeleteInput } } },
      responses: { 204: { description: 'Revoke the canonical PIN profile. Downloaded keys cannot be recalled.' } },
    },
  },
  '/vault-unlock/{scopeId}/recovery-export': {
    post: {
      requestParams: { path: unlockScopeParams },
      requestBody: { content: { 'application/json': { schema: recoveryExportInput } } },
      responses: { 200: { description: 'Single-use authorization for deliberate browser-local recovery export.' } },
    },
  },
};
