# Shared database contracts

Platform-neutral product/domain policies and versioned vault, device, backup and
sync contracts for VIS-65–74, using the installed Zod version. No platform crypto,
storage or UI runtime dependencies.

`parseProductPolicy(unknown)` validates a manifest and returns parsed values or
throws the fixed `persistence_policy_invalid` code. It does not log inputs or
raw Zod issues. Validation does not grant access or select a runtime adapter.
Policy is fixed at product creation; changes require an explicit migration.
Branch implementation may consume this provisional contract under the updated
VIS-65 direction; independent security acceptance remains pending.

See the [provisional ADR](../../../docs/architecture/adr/persistence-saas-zk-hybrid.md)
and [milestone review](../../../docs/reviews/persistence-milestone.md) for the
implemented scope, dependencies and release boundaries. Concrete browser adapters
live in `@visomi-stack/web-frontend-db`; PostgreSQL schemas and resources live in
`@visomi-stack/backend-db`. API authorization and domain services remain
separate from these contracts.

```sh
pnpm nx run-many -t lint,test,typecheck,typecheck-tests -p shared-db
```

These tests validate policies, canonical framing, strict parsing and context
constraints. They do not establish authorization, cryptographic security,
browser vault behavior or native interoperability by themselves.
