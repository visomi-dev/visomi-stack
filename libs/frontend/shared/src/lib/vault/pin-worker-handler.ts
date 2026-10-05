import { pinWorkerRequest } from './pin-worker-contract';
import type { PinWorkerResponse } from './pin-worker-contract';

import { derivePinWrappingKey } from 'shared-crypto/vault-pin';

/** Instantiate only inside a dedicated worker; never import this into the main browser bundle. */
export function createPinWorkerHandler(
  crypto: Crypto,
  respond: (response: PinWorkerResponse) => void,
): (input: unknown) => Promise<void> {
  let busy = false;

  return async (input) => {
    const parsed = pinWorkerRequest.safeParse(input);

    if (!parsed.success || busy) {
      respond({ error: 'pin_worker_invalid_request' });

      return;
    }

    busy = true;
    const { id, pin, envelope } = parsed.data;

    try {
      const key = await derivePinWrappingKey(crypto, pin, envelope);

      respond({ id, key });
    } catch {
      // Never echo a PIN, envelope or low-level error across the worker boundary.
      respond({ id, error: 'pin_derivation_failed' });
    } finally {
      busy = false;
    }
  };
}
