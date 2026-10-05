# Frontend shared

Framework-agnostic browser utilities for the Angular app and Astro website.
The library contains the WebCrypto/IndexedDB vault and WebAuthn PRF adapter.
It has no Angular, Astro, Node.js, database, or backend runtime dependencies.
Browser-only operations must run on the client, not during server rendering.

Portable encrypted-envelope contracts come from `shared-crypto`.
Framework-specific components, dependency injection, and rendering belong in
their owning applications.

## Verification

After loading Node with `fnm`, export `NX_DAEMON=false` and run:

```sh
pnpm nx run frontend-shared:lint
pnpm nx run frontend-shared:typecheck
pnpm nx run frontend-shared:test
pnpm nx run frontend-shared:browser-build
pnpm nx run frontend-shared:browser-smoke
```

The browser bundle checks the entire public entry point and its transitive
dependencies without Node polyfills. The smoke uses real Chromium and IndexedDB.

## Local PIN envelope storage

`UnlockStorage` accepts browser-owned `IDBFactory` and `LockManager` instances.
It persists only validated `LocalUnlockRecord` objects in the separate
`visomi-vault-unlock` database. Do not copy this database, its envelopes, or its
failure state into encrypted record queues, cloud sync, or backup exports.
Records require explicit consent and contain no plaintext PIN or raw key.

Hold `exclusive(ownerUserId, personalScopeId, operation)` across the **entire**
read/derive/check/update sequence. `read`, `replace`, and `remove` do not acquire
the lock automatically: doing so would deadlock a caller already holding it.
Replacement is one atomic transaction; storage errors fail closed without
resetting the database. Owner/scope filtering is not an authorization boundary
against same-origin JavaScript. Missing Web Locks must disable local PIN use,
not fall back to an unlocked operation.

This is storage infrastructure, not application PIN unlock. Enrollment consent,
fresh session checks, cooldown policy, shared PIN authority, worker derivation,
revocation, and key/session cleanup still belong to the application integration.
The existing `BrowserEncryptedVault` format and database are unchanged.

## Dedicated PIN derivation worker

`PinKeyDerivation` takes a factory that creates a **new dedicated Worker for each
attempt**. Bundle `src/pin-worker.ts` as a separate module worker asset; the
`frontend-shared:browser-build` target emits a reference bundle. The public
`src/index.ts` entry deliberately does not export the worker handler or import
`shared-crypto/vault-pin`, so ordinary browser utilities do not load Argon2 WASM.
The owning app must serve the worker asset under its existing CSP and bundler
conventions; Angular worker integration is not enabled by this library alone.

The client validates requests before starting a worker, correlates responses,
accepts only genuine non-extractable AES-GCM-256 wrapping keys, and terminates the
worker on success, failure, ten-second timeout, abort, or `cancel()`. Call
`cancel()` when locking or replacing the owning vault session and pass an
`AbortSignal` for route/operation cancellation. Worker failures must not be
counted as incorrect PIN attempts. A worker derives a key; it does not verify a
PIN or authenticate an account. A wrong PIN is detected only when authenticated
envelope decryption fails, under the application's complete authorization and
cooldown policy.

PIN strings are immutable JavaScript values and cannot be reliably overwritten.
Keep their lifetime short, do not log request payloads, and clear the owning UI
state when finished. The crypto library clears its mutable derivation buffers;
terminating the dedicated worker discards its execution context. Neither step
protects against hostile same-origin code while a session is unlocked.

## Persistent opaque synchronization

`createPersistentBrowserSyncHttp(ownerUserId, options, indexedDB, navigator.locks)`
adapts the existing `/sync/:workspaceId/envelopes` API. Use `/api` as `baseUrl`
behind the composed gateway. Supply the authenticated owner, authorized workspace,
active device and enrollment version; these identifiers do not grant authority.
The server still validates session, account membership and device revocation.

State lives in the separate `visomi-encrypted-sync` database, partitioned by owner
and workspace. Only canonical encrypted sync envelopes, cursor, tombstones and
retry metadata are accepted. PIN envelopes, plaintext and keys are rejected.
Operations reload state under a Web Lock covering the full read/transfer/write
sequence. Missing or denied locks/storage fail closed; quota failures preserve
the previous committed state. Owner partitioning is not protection from hostile
same-origin JavaScript.

Pass an `AbortSignal` in transport options and abort it on logout, device change
or scope teardown. Create a new adapter after reauthentication. Network requests
have a twenty-second timeout and disable HTTP caching. Cancellation and 401 stop
the batch without consuming retries; 409 retains a conflict; other permanent
request/authorization errors retain a blocked entry. Only explicit reconciliation
through `discard(envelopeId, revision)` removes these entries. Transient errors
back off even after the reporting threshold is reached. Successful transfers are
persisted before another transfer's error is reported.

Use `pull(async (changes) => { ... })` to durably apply changes, including deletion
envelopes, **before** acknowledging the cursor. The callback must be idempotent:
a failed state commit can replay an already applied batch. A callback failure
does not advance the cursor. Calling `pull()` without a callback retains the
legacy return-only behavior and is not a durable application integration.

`frontend-shared:browser-smoke` exercises two native Chromium tabs, reload,
owner isolation and real HTTP blocked/conflict replies. This fixture is not a
gateway authorization test. Angular vault/application consumers and conflict UI
remain separate integration work; no financial projections were imported.
