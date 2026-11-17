# Backend database infrastructure

`@visomi-stack/backend-db` owns PostgreSQL/Drizzle infrastructure and schemas. It uses
platform-neutral contracts from `@visomi-stack/shared-db` and the general injection
primitive from `@visomi-stack/backend-shared`. Browser adapters belong in
`@visomi-stack/web-frontend-db`; neither backend library loads Dexie.

`drizzle.config.ts` lives at this library root, alongside `src/`.
`src/lib/` owns the Drizzle factory, domain schemas and single migration
history. `schema-auth.ts` defines the current authentication
tables and is exposed as `authSchema`; `schema.ts` is Kit's schema discovery
barrel. Existing migration SQL, identifiers and snapshots are preserved.

`tools/migrate.mjs` applies that history with the installed Drizzle ORM
migrator. Both the Nx migration target and production pre-deploy command use it.
It closes its own pool and reports failures without connection details or SQL.

Run commands from the workspace root:

```sh
pnpm nx run backend-db:db-generate -- --name describe-schema-change
DATABASE_URL=postgresql://localhost/visomi_stack_dev pnpm nx run backend-db:db-migrate
pnpm nx test backend-db
pnpm nx run backend-db:typecheck-tests
```

The example development database must be created separately. Tests create their
own isolated PostgreSQL clusters; they never migrate a developer database.

Compose runs the same `backend-db:db-migrate` target in a separate one-shot
`database-init` service after PostgreSQL is healthy. The application waits for
successful completion. No authentication seeds are required or inserted; future
required reference data belongs in this initialization step, not API startup.
See [container initialization](../../../docs/development.md#container-database-initialization)
for commands and reruns. Migration generation remains an explicit development
command rather than a container startup action.

The owning executable explicitly calls `createDatabase()`, passes its `db` and
`pool` to its modules, and calls the idempotent `close()` during shutdown. Importing
this library does not initialize a pool, connect or run migrations. A composed
application borrows its host's resources; separate processes own separate pools
against the same database. Query logging is disabled, and idle failures are
reported without raw database errors.

The API's [authentication guide](../../../apps/web/api/README.md) documents the
current schema, security guarantees, configuration and integration tests.

The legacy `libs/backend/shared/tools/database/migrate.mjs` entrypoint is a symlink in the runtime image to
this library so the currently configured provider command remains valid. Its
removal requires a separately authorized provider configuration update. This
refactor changes no SQL, migration IDs, snapshot bytes, tables or stored values.

Before a separately authorized release, the provider's build watch list must
include this library, `libs/shared/db` and `libs/web/frontend/db`. The current
Railway configuration has not been changed or applied by this extraction.
