import type { Passkey } from '../shared/auth/passkey';

import { decodeVaultBytes } from 'shared-crypto';

/** Output is browser-local; the caller must erase it after deriving the wrapping key. */
export async function evaluateVaultPrf(
  passkey: Passkey,
  options: Record<string, unknown>,
  credentialId: string,
  prfInput: string,
  signal: AbortSignal,
): Promise<{ credential: Credential; output: Uint8Array<ArrayBuffer> }> {
  const credential = await passkey.getCredential(
    {
      ...options,
      userVerification: 'required',
      extensions: { prf: { eval: { first: decodeVaultBytes(prfInput, 32) } } },
    },
    { signal },
  );

  if (credential.type !== 'public-key') throw new Error('vault_passkey_mismatch');
  const results = (
    credential as PublicKeyCredential
  ).getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;
  const output = first instanceof ArrayBuffer ? new Uint8Array(first) : undefined;

  if (signal.aborted || credential.id !== credentialId || output?.length !== 32) {
    output?.fill(0);
    throw new Error(
      signal.aborted
        ? 'vault_unlock_cancelled'
        : credential.id !== credentialId
          ? 'vault_passkey_mismatch'
          : 'vault_prf_unavailable',
    );
  }

  return { credential, output };
}
