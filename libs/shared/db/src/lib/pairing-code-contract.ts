import { z } from 'zod';

import { encodedBytes } from './crypto-contract';
import { signingPinSchema } from './device-contract';

// OPAQUE 1.1.0, ristretto255 with SHA-512.
const startLoginRequest = encodedBytes(96);
const loginAnswer = z.strictObject({ loginResponse: encodedBytes(320), signer: signingPinSchema });
const finishLoginRequest = encodedBytes(64);

export const pairingCodeMessageSchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('r1'), r1: startLoginRequest }),
  z.strictObject({ step: z.literal('a1'), a1: loginAnswer }),
  z.strictObject({ step: z.literal('r2'), r2: finishLoginRequest }),
]);

export const pairingCodeExchangeSchema = z.strictObject({
  r1: startLoginRequest.nullable(),
  a1: loginAnswer.nullable(),
  r2: finishLoginRequest.nullable(),
});

export type PairingCodeMessage = z.infer<typeof pairingCodeMessageSchema>;
export type PairingCodeExchange = z.infer<typeof pairingCodeExchangeSchema>;
