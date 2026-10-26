# Shared backend infrastructure

`@visomi-stack/backend-shared` contains backend infrastructure independent of
HTTP. Applications and other backend modules consume its public exports.

## Database

`drizzle.config.ts` lives at this library root, alongside `src/`.
`src/lib/database/` owns the Drizzle factory, domain schemas and single migration
history. `schema-auth.ts` defines the current authentication
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

Compose runs the same `backend-shared:db-migrate` target in a separate one-shot
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

## Email

`src/lib/mail/` owns the SMTP adapter, authentication code and security-notice
content, MJML templates, generated HTML, escaping and plain-text alternatives.
Consumers use `AuthMail`, `CodePurpose` and `SecurityNotice` through the library's
public exports. Mail failures carry only a fixed message; HTTP translation stays
in the calling application.

The owning executable calls `smtpConfig()` and `createSmtp()` and closes the
transport during shutdown. Importing the library does not connect to SMTP.
`AuthMail` accepts that injected transport without owning its lifecycle.

Generate or check the committed resources from the workspace root:

```sh
pnpm nx run backend-shared:emails-build
pnpm nx run backend-shared:emails-check
```

`tools/mail/build-templates.ts` compiles MJML in strict mode, without remote fonts
or includes. Generated resources are bundled by the API; the compiled gateway
continues consuming the compiled API exports. Tests use the isolated SMTP fixture
in `tests/support/smtp.cjs`; production executables never load it.
