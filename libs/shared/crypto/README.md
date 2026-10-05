# Shared crypto

Platform-neutral encrypted-envelope validation, serialization, and client
synchronization. Both backend code and browser utilities consume this package.
Runtime dependencies are limited to Zod and TypeScript helpers; there are no
Node.js, Angular, Astro, storage, or server-runtime imports.

The HTTP synchronization adapter uses the standard Fetch API and accepts an
injected fetcher. Storage and transport are supplied through typed contracts.

## Recipient-bound recovery delivery

`createDeviceIdentity` generates non-extractable ECDSA P-256 and RSA-OAEP-3072
private keys. `createDevicePairing` proves possession of the signing key and
binds both public keys, the client identifier, random challenge and expiration.
`verifyDevicePairing` verifies this proof; it does **not** authorize enrollment,
check expiration, consume a challenge, or grant API permissions. A trusted
application must enforce those boundaries and device revocation separately.

`sealDeviceRecovery` and `openDeviceRecovery` bind encrypted `stack1.` recovery
material to owner, workspace, client, challenge and key generation using the
RSA-OAEP label. This is a new `visomi-device-key-v1` protocol, not a migration of
existing envelopes. Inputs use strict canonical base64url contracts. The
functions clear temporary byte buffers, but JavaScript recovery strings cannot
be reliably overwritten. Persist keys using browser structured-clone facilities,
not private-key exports; do not log or synchronize plaintext recovery material.

These portable primitives are not Nive's finance client/runtime. Its actions,
intake flow, product plugins and ledger projection are intentionally absent.

After loading Node with `fnm`, export `NX_DAEMON=false` and run:

```sh
pnpm nx run shared-crypto:lint
pnpm nx run shared-crypto:test
pnpm nx run shared-crypto:build
```
