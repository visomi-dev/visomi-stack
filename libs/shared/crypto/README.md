# Shared crypto

Platform-neutral encrypted-envelope validation, serialization, and client
synchronization. Both backend code and browser utilities consume this package.
Runtime dependencies are limited to Zod and TypeScript helpers; there are no
Node.js, Angular, Astro, storage, or server-runtime imports.

The HTTP synchronization adapter uses the standard Fetch API and accepts an
injected fetcher. Storage and transport are supplied through typed contracts.

After loading Node with `fnm`, export `NX_DAEMON=false` and run:

```sh
pnpm nx run shared-crypto:lint
pnpm nx run shared-crypto:test
pnpm nx run shared-crypto:build
```
