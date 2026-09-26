# Disposable restore verification

## Executable database and synthetic recovery proofs

Run this only when the coordinator has released the full-server test slot. On the
acceptance host, first use the isolated wrapper setup below; the default runtime
configuration remains broken.

```sh
export NX_DAEMON=false
export XDG_RUNTIME_DIR=/tmp/opencode
eval "$(fnm env)"
fnm use
pnpm nx run template:smoke --restore
```

Prerequisites: a working local Docker/Podman runtime, locally cached
`docker.io/library/postgres:16-alpine`, `docker.io/library/redis:7-alpine`, and
`quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` images, the pinned Node/package
manager, and a complete local package cache. Container startup uses `--pull=never`;
restore-mode dependency installation uses `--offline --frozen-lockfile`. Missing
images/packages fail rather than being fetched. No cloud service is used.

### Real-container acceptance: 2026-09-22

Acceptance on `main` passed in 45.7 seconds using rootless Podman 5.4.2 and
crun 1.21. The isolated store uses workspace `tmp/restore-podman-storage`, runroot
`/tmp/opencode/restore-podman-run-home`, the `vfs` storage driver, explicit runtime
`/usr/bin/crun`, the `cgroupfs` cgroup manager, and the `file` events backend.
Images were explicitly downloaded before verification: PostgreSQL `16-alpine`
(observed server version 16.15), Redis `7-alpine`, and the pinned MinIO release above.

The earlier missing-`crun` diagnosis is **superseded**: crun was installed, and the
error was misleading. The default runtime configuration still fails against stale
`/run/user/1000` state. Acceptance used isolated command-line configuration rather
than a repair of that default configuration.

From the workspace root, the following reproduces the accepted local setup using
the existing ignored wrappers. `tmp/isolated-container-bin/docker` and `podman`
are machine-local, unversioned helpers with absolute paths; they configure the
isolated store through flags. The API runner is also an existing ignored,
machine-local helper. These commands require those helpers to exist on this host.
Set PATH and clear container connection overrides in each shell:

```sh
export NX_DAEMON=false
export XDG_RUNTIME_DIR=/tmp/opencode
eval "$(fnm env)"
fnm use
export PATH="$PWD/tmp/isolated-container-bin:$PATH"
unset DOCKER_HOST DOCKER_CONTEXT CONTAINER_HOST CONTAINER_CONNECTION

# Explicit provisioning; subsequent smoke startup uses --pull=never.
podman pull docker.io/library/postgres:16-alpine
podman pull docker.io/library/redis:7-alpine
podman pull quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
pnpm nx run template:smoke --restore
node tmp/run-template-checks.cjs api-e2e:e2e
```

The private-Redis API runner binds published container ports only to `127.0.0.1`.
Its `api-e2e:e2e` run passed in 1 minute 3 seconds: 24 memory-backed HTTP tests in
6 suites, plus 4 durable sync-restart/device-approval tests in 2 suites against
real PostgreSQL and MinIO.

Restore evidence is the ignored `tmp/template-smoke-MS7mHM/result.json` manifest:
schema/data hashes were recorded, migrations and password authentication continuity
passed, and the encrypted canary proved restored-byte equality, source deletion
before restore, authenticated decryption, and missing/wrong-key rejection. The
synthetic TOTP-v1 fixture also passed authenticated decryption and missing/wrong-key
rejection. Scope remains `database-and-synthetic-recovery-fixtures`;
`fullProductVaultRecovery` and `productionKeyEscrowRecovery` are both `false`.

Restore mode rejects `--memory`, `SMOKE_DATABASE_URL`, and `SMOKE_REDIS_URL`.
It never reads ambient `DATABASE_URL` as an infrastructure target. The source is
a task-owned container and the destination is a **new database in that disposable
PostgreSQL instance**, created without a drop/overwrite option. This verifies
logical recovery, not recovery onto a different PostgreSQL version or machine.

The command:

1. Exports an isolated source copy and initializes its own generated secrets.
2. Starts task-owned, loopback-bound PostgreSQL/Redis/MinIO and applies the actual migrations.
3. Builds the composed runtime and performs real password signup and email verification.
4. Stops that runtime to quiesce database writers.
5. Inserts a synthetic encrypted TOTP-v1 fixture into a dedicated disposable
   `restore_fixture` schema. Its generated encryption key lives in a separate
   owner-only local file, never in the database. Produces a custom-format `pg_dump`
   with owner-only permissions inside the container.
6. Creates `template_restore` and uses transactional `pg_restore --exit-on-error`.
7. Compares schema and data dump SHA-256 fingerprints, including the migration ledger,
   account records, and password hashes. Only randomized psql restriction tokens
   are removed before hashing; a mismatch fails closed.
8. Reads the TOTP fixture from the restored database and reopens the protected key
   file. Checks authenticated decryption and rejection of missing/wrong keys.
9. Runs the encrypted object canary backup/restore described below.
10. Re-runs migrations against the restored database and starts the runtime there.
11. Clears browser cookies and completes password sign-in, email second step, and
    an authenticated full-session check against the restored destination.
12. Writes a bounded result manifest and removes the dump, containers, runtime,
    and copied project in cleanup. `--keep` retains the copied project with its
    disposable secrets; treat it as sensitive and remove it after debugging.
    The canary backup and protected TOTP fixture key are removed even with `--keep`.

Evidence is written to ignored `tmp/template-smoke-*/result.json`. The parent
directory is mode `0700`. Success contains
`restore.scope: "database-and-synthetic-recovery-fixtures"`, schema/data hashes,
migration/password-authentication flags, `objectCanary`, and
`serverTotpKeyContinuity`. It explicitly sets `fullProductVaultRecovery: false`
and `productionKeyEscrowRecovery: false`. A failed command
does not emit successful restore evidence. Logs remain private diagnostic data;
do not publish them wholesale. Unit tests with injected command responses verify
orchestration and failure handling; they do not prove PostgreSQL or MinIO behavior.

## Executable object and key-continuity fixtures

`scripts/template/restore-objects.ts` reuses the repository's pure SigV4
`RailwayS3ObjectStore` adapter against the task-owned MinIO port. Source and
destination are newly named private buckets in that disposable instance, with
generated fixture access credentials passed through named environment variables,
not credential values in command arguments. Ambient object-store endpoints or
credentials are never selected. Signed requests have deadlines and reject redirects.

The runner generates a synthetic plaintext and a fresh 256-bit symmetric fixture
key, encrypts locally with AES-256-GCM and domain-specific authenticated metadata,
then uploads only the versioned nonce/tag/ciphertext envelope. It downloads the
encrypted object into a `0600` backup within a `0700` directory, deletes and
verifies absence of the source object, and uploads the backup bytes to the new
destination bucket. It verifies restored byte equality and SHA-256, authenticates
and compares decrypted plaintext in the runner, and proves missing and wrong keys
cannot decrypt. The client-side fixture key is held only in runner memory; it is
never written into the backup, database, container environment, server, or result
manifest. Key/plaintext buffers are cleared in cleanup. Both canary objects and
the local encrypted backup are removed; container teardown removes the buckets.

`scripts/template/restore-crypto.ts` also creates a separate generated server-key
fixture in a `0600` file under a `0700` directory. Its synthetic base32 TOTP secret
uses the application's v1 encoding and KDF (`scrypt`, `themis-totp-secret-v1`,
AES-256-GCM). Only encrypted secret/version enter PostgreSQL via SQL stdin. The
key is reopened after the database restore rather than retained as the original
encryption buffer. Correct-key decryption and missing/wrong-key rejection must
pass before positive evidence is returned. This deliberately avoids reading
ambient `AUTH_TOTP_ENCRYPTION_KEY` or session secrets.

These are **synthetic boundary and key-continuity fixtures**, not real customer
keys, full product/vault restoration, object version-history recovery, database
envelope-reference reconciliation, a product TOTP enrollment/login scenario, or
a production key-escrow service. The generated server-key fixture is independent
of the application's runtime key. It proves that separately preserved key material
can authenticate a restored v1 encrypted record; it does not recover a lost key.

## Production recovery sequence

This command is a disposable rehearsal, not a production restore utility.
For a real incident, record the desired recovery point, application release,
PostgreSQL version, migration revision, and authorized recovery owner first.

1. Quiesce writes and preserve forensic evidence. Restore PostgreSQL into a new,
   access-restricted destination with a compatible PostgreSQL client/server pair.
   Recover roles/extensions and grants separately when required by the deployment.
2. Verify table integrity, migration history, tenant boundaries, and authorization
   state before directing any traffic to the destination. Apply only migrations
   compatible with the restored release.
3. Restore opaque object bytes and their versions to a new private bucket. Match
   database envelope references, object keys, ciphertext hashes, cursors,
   checkpoints, and tombstones to the same recovery point. A database dump alone
   cannot reconstruct objects stored outside PostgreSQL.
4. Restore required **server-owned** encryption material from separate access-controlled
   escrow. In particular, encrypted TOTP records require their original TOTP
   encryption key or a documented version-aware key-rotation procedure. The
   disposable password proof retains its generated configuration and does **not**
   prove recovery of that key from escrow or TOTP authentication continuity.
5. Choose explicitly whether sessions survive. The rehearsal proves fresh
   authentication, not Redis session recovery. Do not replay expired OTPs or old
   transient authorization challenges. Verify revocation state before reopening access.
6. Reconcile changes after the recovery point, including membership exits and
   revocations. Never restore an exited member's authorization merely because an
   older snapshot contained that membership.
7. Validate with approved synthetic accounts and ciphertext canaries before cutover.
   Keep old infrastructure fenced until recovery is accepted.

## Opaque objects and client-owned key limits

The executable now includes the independent S3 canary and protected TOTP-key
fixture above; the composed application itself still uses memory opaque storage.
Actual PostgreSQL/MinIO container acceptance passed on 2026-09-22 as recorded above.
Unit tests additionally cover cryptography, missing/wrong keys,
tampering, missing/corrupted objects, file permissions, cleanup, SigV4 adapter
wiring with a simulated transport, and database orchestration with injected
command responses. Those unit tests alone are not real-container acceptance evidence.
Full-system acceptance additionally requires product envelope references,
object versions, cursors, checkpoints, tombstones, and recovery-point reconciliation.
The accepted runs do not automatically cover PostgreSQL multi-connection races.
Physical authenticators, provider flows, and human acceptance remain separate;
see [real-device validation](auth-real-device-validation.md).

Never send client plaintext, private vault keys, recovery keys, or passkey private
keys to the server to make a restore test pass. Server recovery cannot recreate
lost client-owned keys. Recovery of encrypted content requires a surviving
authorized client device or the client's supported recovery mechanism. A restored
public credential record does not recreate its private authenticator.

## Retention and membership exits

The product policy is **immediate workspace membership exit**, not global identity
or data deletion. Exit must immediately deny future workspace access; it does
not promise that old backups or ciphertext versions disappear immediately.
Document backup retention, object-version retention, tombstone retention, legal
holds, encryption-key retention, and the maximum historical recovery window.
Retain tombstones and revocation reconciliation data long enough to cover every
recoverable snapshot. Shorter retention can resurrect deleted objects or access.
Key destruction can make retained ciphertext permanently unrecoverable; retaining
server keys also preserves the ability to decrypt server-owned encrypted records.
Do not label either operation as global account erasure.
