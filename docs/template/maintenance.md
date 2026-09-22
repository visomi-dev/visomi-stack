# Maintaining Derived Projects

## Version contract

`template.json#template` records the upstream repository and template version used at initialization. Version `0.1.0` identifies this bootstrap contract; it is source metadata, not a claim that a GitHub release has already been published. Derived project/package names and application versions evolve independently.

When publishing an upstream template release:

1. Run template unit/type checks, clean-copy PostgreSQL smoke, critical/full E2E as appropriate, and the container build.
2. Record user-visible changes and upgrade instructions, including environment/schema changes.
3. Update template metadata only after the new bootstrap contract is verified.
4. Publish a versioned release when explicitly requested; include the source revision and verification evidence.

For an existing derived project, review upstream changes by behavior slice. Apply code/configuration changes deliberately, preserve local business behavior and secrets, apply append-only database migrations, and run the project's own regression suite. Do not rerun `template:init` to upgrade or rename an initialized application.

## Toolchain updates

Update `.node-version`, `package.json#packageManager`/`engines`, and Docker together. CI reads the version file/packageManager directly. Run the toolchain consistency test and a fresh frozen install. Keep Nx packages aligned; maintain the TypeScript 7 CLI / TypeScript 6 compiler-API alias arrangement until the relevant integrations support another configuration.

Shared Drizzle/Redis/runtime dependency versions also appear in internal workspace manifests. Update compatible versions together rather than adding duplicate incompatible types. Dependency automation should propose reviewable changes, not bypass local hooks or frozen-lockfile checks.

## Environment and database changes

- Initializer reruns with identical settings are no-ops and do not rotate secrets.
- A new variable needs a schema entry, `.env.example`/production inventory documentation, doctor handling where relevant, and tests.
- Never edit a previously applied SQL migration. Doctor compares local migration hashes with the database history; it does not repair mismatches automatically.
- Generate new environments separately from existing local databases. New Compose project/volume names do not rename old `themis-local` volumes.
- Back up and validate restoration of durable data before a production migration. Secret/domain changes require their own migration plan.

The current initialization is intentionally an explicit four-file operation rather than a global replacement engine. Additional reusable transformations should be added as versioned, idempotent migrations with fixture tests before being offered to downstream projects.
