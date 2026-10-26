# API authentication and persistence

The baseline is PR #2. Its observability runtime, import-safe `createApp`, stable CommonJS `app.js`/`main.js` exports, and test boundaries are retained.

## Dependencies and database commands

Drizzle belongs to the shared backend database module at `libs/backend/shared/src/lib/database/`, not to the API. The library-level `libs/backend/shared/drizzle.config.ts` sits alongside `src/`; the database module owns the domain schema in `schema-auth.ts`, the schema discovery barrel `schema.ts`, and the single `migrations/` history. API authentication consumes `authSchema` through `@visomi-stack/backend-shared`; other backend modules use the same shared definitions and migration history.

Runtime dependencies are pinned in both workspace and API manifests: Drizzle ORM `1.0.0-rc.5`, `pg` `8.23.1`, SimpleWebAuthn server `14.0.3`, Passport `0.7.0`, express-session `1.19.0`, and connect-pg-simple `10.0.0`. Drizzle Kit is pinned to `1.0.0-rc.5`. Generated runtime package metadata includes the external dependencies.

From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm nx run backend-shared:db-generate -- --name describe-schema-change
DATABASE_URL=postgresql://localhost/visomi_stack_dev pnpm nx run backend-shared:db-migrate
pnpm nx serve web-api
```

The database URL above is an example for a separately created local development database, not a test target or an instruction to migrate an existing database. Supply `DATABASE_URL`, `AUTH_ORIGIN`, `AUTH_RP_ID`, and `SESSION_SECRET` in the owning process environment before serving. No `.env` loader, schema push, synchronization, or automatic migration runs during imports or startup. The shared Nx targets run Kit from `libs/backend/shared/` with its checked-in `drizzle.config.ts`; generation needs no connection. Migrations use the [Drizzle v1 directory/snapshot layout](https://orm.drizzle.team/docs/upgrade-v1), not a legacy journal. Relocation preserves all existing migration identifiers, SQL and snapshots; it does not introduce another migration history.

`AUTH_ORIGIN` is one canonical origin without a trailing slash; HTTP is allowed only for loopback development. `AUTH_RP_ID` must equal that host or a permitted parent domain. `SESSION_SECRET` must contain at least 32 bytes and must match across instances; supply a high-entropy value outside the repository. Production origins require HTTPS and secure `__Host-visomi.sid` cookies. Local HTTP uses `visomi.sid`. Cookies are HttpOnly, SameSite=Strict, host-only, and scoped to `/`.

Forwarded headers are untrusted by default. Behind TLS termination, set `AUTH_TRUST_PROXY` to the explicit trusted proxy addresses/CIDRs, separated by commas. Imported hosts can set `trustProxy` or configure their own Express host before installing authentication. Do not trust arbitrary forwarded headers to enable secure cookies or derive rate-limit addresses.

Without `DATABASE_URL`, standalone startup retains the public greeting and `/auth` returns a fixed 503. There is no memory-store fallback. With database configuration, `main.ts` creates the pool, checks connectivity before listening, drains HTTP work, closes that pool, then shuts down telemetry within the existing deadline. Construction never connects until explicitly used. Database queries and parameter-bearing errors are not logged.

Shared infrastructure does not create a global connection on import. The owning executable calls `createDatabase()` and passes its database/pool to the modules it composes. An imported API never closes caller-owned resources. Separate processes own separate pools and connect to the same PostgreSQL database; no JavaScript object is shared across processes.

## Schema and transaction boundaries

- `auth_users`: server-generated UUID identity and creation timestamp. No email, password, tenant, account, membership or provider model is introduced.
- `auth_credentials`: user FK, unique WebAuthn credential ID, COSE public key, counter, transports, RP, label, backup eligibility/state, and creation/update/use/revocation timestamps. Constraints enforce bounded nonnegative counters, valid identifiers/transports and consistent backup flags; owner/revocation lookup is indexed.
- `auth_sessions`: the established session store's SID/JSON/expiration columns plus creation and revocation timestamps. Expiry and serialized-user lookups are indexed. A migration trigger enforces an eight-hour absolute lifetime and immutable, empty, expired revocation tombstones. Only `destroy` is adapted to persist tombstones, including unknown SIDs; ordinary get/set/touch use connect-pg-simple. Automatic pruning is disabled so arbitrarily delayed writes cannot resurrect a deleted SID.
- `auth_challenges`: one pending ceremony per session, session FK, purpose, server-selected subject, challenge hash and three-minute expiry. A conditional `DELETE ... RETURNING` consumes it atomically under the session row lock. Consumption commits before cryptographic verification, so failed attempts also burn the challenge. Starting another ceremony supersedes the previous one.
- `auth_rate_limits`: indexed, expiring shared PostgreSQL counters. Atomic upserts enforce 60 authentication requests/minute per keyed address digest and 1,000/minute globally across instances. Missing storage fails closed. No rate-limit keys or addresses enter telemetry.

A signup allocates the identity on the server and inserts the user and first credential together only after WebAuthn verification. Bodies cannot choose an existing user or attach an email. An authenticated enrollment binds its subject to the current user and requires a passkey session authenticated within five minutes. Signing in verifies a discoverable credential, RP, origin, user verification, user handle where supplied, counter and backup consistency. SimpleWebAuthn performs cryptographic verification; its supported algorithms are retained.

User security mutations and authentication serialize on the user, session and credential rows in that order. Credential conflicts roll back identity creation. Removing the last active credential is rejected. Removing another credential revokes all sessions authenticated by it in the same transaction. Logout and Passport login rotation tombstone the old SID; an already revoked SID cannot establish a replacement login. Passport deserialization rechecks credential ownership and revocation on each request.

Credential-session revocation filters by both the serialized owner ID and credential ID, matching the existing `auth_sessions_user_idx` expression. Other users' sessions remain outside that transaction's update scope. Counter concurrency is tested with independently signed assertions from separate sessions and challenges; replay of one challenge is a separate invariant.

Expired challenges and rate buckets may be removed by explicit maintenance. Neither expired SID rows nor revocation tombstones may be deleted under this stale-write contract. A bounded retention protocol and recovery after losing every passkey are separate future decisions.

## HTTP contract

Paths are relative to the app mount. The standalone API uses `/auth`; a host mounting at `/api` exposes `/api/auth`.

| Method | Path                                    | Behavior                                                                                                 |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/session`                         | Anonymous or authenticated session inspection, minimal user identity and synchronizer CSRF token         |
| POST   | `/auth/passkeys/registration/options`   | Begin a new identity or fresh authenticated credential enrollment; body `{}`                             |
| POST   | `/auth/passkeys/registration/verify`    | Verify `{challengeId, response, label?}`, persist credential, rotate session and return a new CSRF token |
| POST   | `/auth/passkeys/authentication/options` | Begin discoverable passkey sign-in; body `{}`                                                            |
| POST   | `/auth/passkeys/authentication/verify`  | Verify `{challengeId, response}`, update counter/backup metadata and rotate session                      |
| GET    | `/auth/passkeys`                        | List the current user's active credential metadata                                                       |
| PATCH  | `/auth/passkeys/:id`                    | Rename an owned credential with `{label}` and fresh authentication                                       |
| DELETE | `/auth/passkeys/:id`                    | Revoke an owned credential with fresh authentication; refuse the last credential                         |
| POST   | `/auth/logout`                          | Revoke the current session and clear its cookie; body `{}`                                               |

First fetch `/auth/session`, retain its cookie and token, then send the configured `Origin` and `X-CSRF-Token` on every mutation. Use the newly returned token after login or enrollment rotation. All authentication responses disable caching. JSON bodies are limited to 32 KiB. Authentication does not unlock or decrypt a vault.

## Managed and inherited ownership

`createApp({ auth, authMode })` has one implementation. `authMode` defaults to `managed`: the supplied auth runtime installs session, Passport initialization, and Passport session handling before authentication-dependent routes. With no supplied runtime, those routes fail closed with 503 and public greeting/import compatibility remains available.

In `inherited`, install the same runtime on the real parent before mounting the API.
In a workspace host, shared-library imports are bundled by its build; `api` below
is the compiled `app.js` module loaded by the host, as in the gateway:

```ts
import { securityHeaders, httpErrorHandler } from '@visomi-stack/web-backend-shared';

const auth = api.createAuthentication({ database, pool, config: api.authConfig(trustedConfiguration) });
host.use(securityHeaders());
host.use(auth.middleware);
host.use(
  '/api',
  api.createApp({
    auth,
    authMode: 'inherited',
    helmetMode: 'inherited',
    errorMode: 'inherited',
  }),
);
host.use(httpErrorHandler);
```

The host owns `database` and `pool`; the imported app never closes them. An explicit per-request initialization marker checks that this runtime's full chain ran. The API does not inspect Express internals or infer initialization from `req.user`. Missing initialization returns `503 auth_initialization_missing`, while properly initialized anonymous sessions work and protected routes still return 401. There is no second session/Passport chain in inherited mode.

The current `web-gateway` implements this contract at `/api`: its ESM executable
loads the compiled API's CommonJS `app.js`, creates the auth runtime using the
host-owned pool and installs the middleware before mounting. `pnpm nx serve
web-gateway` builds the API first. Gateway process integration tests verify real
PostgreSQL-backed authentication and cleanup; Angular SSR remains unimplemented.

`helmetMode` and `errorMode` also default to `managed`, independently of
`authMode`. In inherited mode the parent must install security headers before
the API and the shared error handler after it. Authentication guards stay active.
Auth normalizes private persistence and parser failures to public `HttpError`
values, then delegates the response to its owner. `AuthHttpError` is used for
401/403; validation and challenge failures retain 400, with conflicts, rate limits
and availability errors retaining their existing statuses. Existing code-only
responses remain compatible; explicit public messages and JSON bodies are
optional. See the [shared HTTP contract](../../../libs/web/backend/shared/README.md).

## Verification and reference differences

```sh
pnpm nx test backend-shared
pnpm nx test web-backend-shared
pnpm nx test web-api
pnpm nx test web-api -- auth-persistence.integration.spec.ts
pnpm nx e2e web-api
pnpm nx run-many -t lint typecheck typecheck-tests -p web-api web-backend-shared backend-shared
pnpm nx build web-api
```

Integration and Playwright setup create an isolated Compose project using the PostgreSQL image from `compose.yaml`, apply the shared database module's checked-in migrations, and stop/remove only that project's containers and volumes. They never use developer `DATABASE_URL`. Docker with Compose v2 or Podman with `podman-compose`, an unprivileged local user with engine access, and free loopback ports are required. Native PostgreSQL binaries and `PG_BIN` are not used. The explicit `backend-shared:db-migrate` command is also exercised against a new database within the owned cluster and rerun to verify that existing state is retained.

Playwright retains the API's existing configuration and request fixtures. A test-only wrapper starts isolated Compose PostgreSQL, builds the selected application image, runs the Compose database initializer, and launches the compiled application in a container. The parent-Express inherited fixture imports the compiled app; it establishes no gateway/Angular SSR/i18n claim. A synthetic software authenticator produces real ES256 signatures verified by SimpleWebAuthn. These are not mocked verifier successes, physical authenticator tests or full FIDO/browser certification. Colocated units cover each logic module; schema, declarations, barrels and static Kit configuration are validated through typing/integration rather than artificial unit suites.

Unlike v0, no tenancy, OTP, social login, recovery, vault orchestration, module-import database singleton, optional auto-migration, insecure SSL override, custom session authority framework, or process-local rate-limit Map is carried over. There is one PostgreSQL source of truth for each stateful responsibility. The shared observability remains the only operational telemetry path, with no parallel auth logger or SQL instrumentation.
