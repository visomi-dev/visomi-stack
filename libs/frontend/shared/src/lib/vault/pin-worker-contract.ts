import { z } from 'zod';

import { localPinEnvelope } from 'shared-crypto';

export const pinWorkerRequest = z.strictObject({
  id: z.uuid(),
  pin: z.string().regex(/^[0-9]{6}$/),
  envelope: localPinEnvelope,
});
export type PinWorkerRequest = z.infer<typeof pinWorkerRequest>;
export type PinWorkerResponse =
  { id: string; key: CryptoKey } | { id?: string; error: 'pin_worker_invalid_request' | 'pin_derivation_failed' };
