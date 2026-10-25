# Development testing support

Internal Nx source library for shared test dependencies. Application-specific
fixtures, authentication database access, serve entrypoints and preloads stay in
each application's existing `e2e/` directory. No production module imports this
library; ESLint enforces that boundary.

| Entry                                  | Purpose                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@visomi-stack/dev-testing`            | Synthetic ES256 authenticator and owned PostgreSQL helpers; does not load Playwright     |
| `@visomi-stack/dev-testing/postgres`   | Isolated PostgreSQL startup, explicit migrations and ownership-checked cleanup           |
| `@visomi-stack/dev-testing/playwright` | Shared telemetry fixture, `expect` and teardown for owned application/database processes |
| `@visomi-stack/dev-testing/telemetry`  | Local file exporters and telemetry reader; importing does not initialize telemetry       |

```ts
import { test as base } from '@visomi-stack/dev-testing/playwright';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';
```

All exported implementation lives under `src/lib/`. Playwright-specific fixtures
and support live in `src/lib/playwright/`; PostgreSQL, authenticator and CBOR helpers
live directly in `src/lib/`. Every helper has colocated Vitest tests, and `src/`
contains the public re-export entries. The library does not own an E2E suite;
the applications exercise this support through their existing suites.

The workspace uses source aliases, not independently installed library packages.
Playwright and Vitest use the applications' test configuration; scripts launched
with tsx from the workspace root pass that tsconfig explicitly. Each server
preload configures the same aliases before requiring the telemetry entry. These
are development-only loaders, not production initialization.

PostgreSQL helpers always create a dedicated owned cluster, never use developer
`DATABASE_URL`, and explicitly apply the shared database migrations. `PG_BIN`
selects the local PostgreSQL binaries; the default is `/usr/lib/postgresql/17/bin`.
An explicit Nx dependency on `backend-shared` tracks migration changes. Tests stub
process/network/database boundaries for ownership and failure cases; the API and
gateway integration/E2E suites continue exercising real PostgreSQL and HTTP.
No telemetry is sent to external services.

From the workspace root:

```sh
pnpm nx test dev-testing
pnpm nx run-many -t lint typecheck typecheck-tests -p dev-testing
pnpm nx run-many -t e2e -p web-api web-gateway
```

Coverage requires 100% statements, branches, functions and lines per helper,
including files not imported by a test. Reports are written under
`coverage/libs/development/testing`. Playwright's registration boundary is stubbed
in the fixture unit tests; actual fixture composition and exporter delivery are
verified by the applications' existing E2E suites.
