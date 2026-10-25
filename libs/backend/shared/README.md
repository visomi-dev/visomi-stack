# Shared backend infrastructure

`@visomi-stack/backend-shared` contains backend infrastructure independent of
HTTP. Applications and other backend modules consume its public exports.

## Database

`src/lib/database/` owns the Drizzle factory, configuration, domain schemas and
single migration history. `schema-auth.ts` defines the current authentication
tables and is exposed as `authSchema`; `schema.ts` is Kit's schema discovery
barrel. Existing migration SQL, identifiers and snapshots are preserved.

Run commands from the workspace root:

```sh
pnpm nx run backend-shared:db-generate -- --name describe-schema-change
DATABASE_URL=postgresql://localhost/visomi_stack_dev pnpm nx run backend-shared:db-migrate
pnpm nx test backend-shared
pnpm nx run backend-shared:typecheck-tests
```

The example development database must be created separately. Tests create their
own isolated PostgreSQL clusters; they never migrate a developer database.

The owning executable explicitly calls `createDatabase()`, passes its `db` and
`pool` to its modules, and calls the idempotent `close()` during shutdown. Importing
this library does not initialize a pool, connect or run migrations. A composed
application borrows its host's resources; separate processes own separate pools
against the same database. Query logging is disabled, and idle failures are
reported without raw database errors.

The API's [authentication guide](../../../apps/web/api/README.md) documents the
current schema, security guarantees, configuration and integration tests.
