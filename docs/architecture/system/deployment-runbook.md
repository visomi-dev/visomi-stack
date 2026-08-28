# Production Gateway Runbook

This runbook describes a provider-neutral production-like deployment. The
hosting provider, TLS termination, and S3-compatible vendor remain explicit
deployment decisions; no provider is implied by this repository.

## Topology and ownership

The public TLS gateway exposes one origin. `apps/web/server` mounts the Astro
site at `/`, the Angular SSR app at `/app`, the API at `/api`, and Socket.IO at
`/socket.io`. The gateway starts `apps/worker` as a managed child process and
loads the realtime adapter. PostgreSQL is the durable relational store, Redis
is the BullMQ broker, and S3-compatible storage holds opaque encrypted sync
objects only. The release owner owns the gateway and rollback; the data owner
owns PostgreSQL backups/restores; the security owner owns signing keys,
advisories, and key rotation.

## Configuration and fail-closed gates

Start from `deploy/production.env.example` and generate `production.env` from
Railway secret variables (or the equivalent provider secret manager); never
commit the generated file. Railway owns `PORT` and it takes precedence over
the local/Compose-compatible `GATEWAY_PORT`. Do not put secrets in images,
compose files, logs, or generated release metadata. Production startup rejects development session
secrets, memory storage, automatic migrations, insecure cookies, missing
PostgreSQL/Redis/object-storage settings, or an absent pinned local-agent key.
For a local production-like run, use `cp deploy/production.env.example
deploy/production.env`, replace every placeholder with the Railway variable
values, and then run `podman compose --env-file deploy/production.env -f
deploy/compose.production.yaml up --build`.
`pnpm release:gate` must verify the signed artifact, signed key catalogue,
artifact hash, provenance metadata, and protected-plaintext scan before rollout.

## Release procedure

1. Build with `pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production`.
2. Generate the immutable image with `docker build --target runtime --tag themis:<git-sha> .`.
3. Record the git SHA, image digest, dependency lockfile digest, SBOM, and
   signed release manifest. Verify the manifest and catalogue before promotion.
4. In a disposable production-like environment, apply migrations explicitly
   with `pnpm db:migrate` and `DATABASE_AUTO_MIGRATE=false`, using the release's schema
   and a real PostgreSQL instance. Capture the migration report.
5. Deploy the image, wait for `/readyz`, then exercise real HTTP through the
   public-like gateway. Never use a unit or memory-driver result as migration
   evidence.

## Health, shutdown, and rollback

`/healthz` is liveness; `/readyz` is the traffic gate and must be checked after
all API, Angular, Astro, realtime, and same-process worker dependencies have
booted. A bootstrap or managed-worker failure leaves readiness failed closed;
the worker is intentionally not a separate Railway service. On SIGTERM, the gateway stops accepting new
connections, asks the worker to drain, and exits after a bounded 10-second
grace period. Keep the previous signed image and schema version available.
Rollback application code only when the previous image is compatible with the
current schema. For an incompatible migration, prefer a forward fix; restore
PostgreSQL and opaque object storage only after an approved backup-restore
exercise and an explicit data-owner decision. Redis is rebuildable queue state,
but in-flight jobs must be reconciled after rollback.

## Backups, observability, and advisories

Use encrypted, access-controlled PostgreSQL backups with a tested restore and
retention policy. Back up opaque object storage with the same tenant and key
custody controls; never decrypt objects in the backup pipeline. Ship structured
logs and metrics without cookies, authorization headers, secrets, or protected
plaintext. Review dependency advisories and document accepted, fixed, or
release-blocking status before promotion. Signing keys stay in dedicated key
custody, rotate by adding a time-bounded catalogue entry, and revoke through a
new signed catalogue.

## Release status

This slice is **not a production-readiness declaration** while ZK-014, SEC-001,
SYNC-001, or E2E-001 has an unresolved release-blocking finding. Provider
specific TLS, managed backup, object-storage IAM, and key-custody choices are
uncertainties until recorded by the deployment owner.
