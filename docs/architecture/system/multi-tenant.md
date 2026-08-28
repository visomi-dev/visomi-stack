# Multi-Tenant Architecture

## Purpose

Capture the current multi-tenant direction for Themis and the constraints that future backend features must follow.

## Decision

Themis uses a **hybrid multi-tenant architecture**.

Default mode:

- shared database
- shared schema
- explicit `account_id` on tenant-owned data
- Postgres RLS for database-level tenant isolation
- app-layer authorization on top of RLS

Future path:

- specific tenants can later be promoted to stronger storage isolation if product or compliance requirements demand it

## Why This Direction

- keeps open-source and default deployments simple
- avoids the migration and operational overhead of schema-per-tenant too early
- still gives Themis a strong tenant boundary from the beginning
- leaves room for stronger isolation later without redesigning the whole domain model

## Tenant Model

Use these concepts consistently:

- `users` are global identities
- `accounts` are tenant boundaries
- `account_memberships` define which users belong to which accounts and with what role

Do not treat `user_id` alone as the tenant boundary.

## Required Tenant-Owned Fields

Tenant-owned backend data should carry `account_id`.

Examples:

- projects
- project documents
- async jobs
- API keys
- activation milestones

## Isolation Rules

### Database Layer

- enable RLS on tenant-owned tables
- policies should restrict rows by `account_id`
- set tenant context in the database session before tenant-scoped operations

### Application Layer

- validate authenticated membership before feature access
- pass account context explicitly into tenant-scoped operations
- never expose unscoped repository or service helpers for tenant-owned data

### Realtime Layer

- emit events only to account- or user-scoped channels
- validate access before joining or resolving any room-like concept

### Job Layer

- async jobs must carry account context explicitly
- workers must re-check account ownership before operating on tenant-owned resources

## Noisy Neighbor Protection

RLS does not solve runtime contention.

Add separate controls such as:

- per-account queue limits
- per-account job concurrency
- per-account rate limits
- later, per-account quotas if product usage demands them

## Rejected Default

Schema-per-tenant is not the default.

Reason:

- it adds migration and operational complexity too early
- shared-schema plus explicit tenant boundaries is the preferred default for the current stage of Themis

## Implication For Future Features

Any new backend feature should answer these questions up front:

1. what is the tenant-owned record?
2. where is `account_id` stored?
3. what authorization middleware protects it?
4. what RLS policy applies?
5. what account context does the job or event carry?
