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
