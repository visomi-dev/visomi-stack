# Operational verification implementation and acceptance plan

| Phase               | Owned scope                                                                        | Status                     | Gap                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Correlation         | Shared context/logger, gateway/API middleware, API producer, project worker        | Implemented and integrated | None in focused verification                                                        |
| Operational metrics | Fixed-cardinality process counters and optional safe reporter                      | Implemented                | No durable aggregation/exporter                                                     |
| Database restore    | Disposable smoke restore mode, schema/data comparison, post-restore authentication | Accepted 2026-09-22        | Logical restore in disposable PostgreSQL; cross-machine/version recovery not proved |
| Objects and keys    | Encrypted MinIO canary and protected TOTP-v1 database fixture                      | Accepted 2026-09-22        | Full product/escrow recovery is outside fixture scope                               |

## Validation matrix

| Category    | Requirement                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Required: async isolation, bounded IDs, job propagation, redaction, counters, strict worker parsing, restore command failure/cleanup          |
| API         | Local HTTP and container-backed durable suites passed 2026-09-22; smoke restore proved post-restore password authentication                   |
| App E2E     | Not applicable: no browser route or UI changes                                                                                                |
| Gateway E2E | Disposable composed smoke restore passed 2026-09-22; reserve the full-server slot for future runs                                             |
| Site E2E    | Not applicable beyond existing smoke branding/locale checks; site behavior unchanged                                                          |
| Visual      | Not applicable: no visual changes                                                                                                             |
| Security    | Required: reject ambient/disallowed restore targets, redact operational payloads, fail closed on integrity mismatch, owner-only dump, cleanup |
| Build       | Required: shared build, template build/typecheck, then coordinator-integrated worker/API/server builds                                        |

## Focused commands

### Historical focused results: 2026-09-20

The acceptance blocker below is superseded by the 2026-09-22 results.

- Shared observability/logger/HTTP: 15 tests passed, including cross-module sharing,
  duplicate middleware, async boundary recovery, and safe error logs with unchanged
  response contracts; shared TypeScript build passed.
- API standalone/embedded logging wiring: 2 tests passed.
- Server unit tests: 15 tests passed across 3 suites.
- Worker processor validation: 2 tests passed.
- Template: 24 tests passed, including 7 database/isolation tests, 3 cryptographic
  key-boundary tests, and 5 object-store fixture tests; build and typecheck passed.
  Tests exercise the reused SigV4 adapter through a simulated transport, verify
  private backup/key-file permissions and cleanup, and reject corrupted/missing
  objects, missing/wrong keys, and altered authenticated ciphertext.
- Scoped `template:operations-lint`: passed with no findings.
- Worker build: passed after coordinator barrel integration, including shared and
  projects dependency builds.
- Full PostgreSQL/MinIO container restore and full-server acceptance: not executed
  at that checkpoint; this blocker is superseded by the 2026-09-22 acceptance below.
  Synthetic TOTP key continuity and encrypted object restore were already
  executable parts of `--restore`.
  Full product vault recovery, actual product TOTP login, and production key-escrow
  recovery are not proved by those fixtures.

Every shell must initialize fnm and set `NX_DAEMON=false` as shown in the restore
runbook. Run:

```sh
pnpm nx run shared:test --runInBand --testPathPatterns='observability|logger|http'
pnpm nx run api:test --runInBand --testPathPatterns=app-observability
pnpm nx run server:test --runInBand
pnpm nx run worker:test --runInBand --testPathPatterns=processor
pnpm nx run template:test
pnpm nx run template:typecheck
pnpm nx run template:operations-lint
pnpm nx run shared:build
pnpm nx run worker:build
```

### Real-container acceptance: 2026-09-22

Verified on `main` with an isolated rootless Podman 5.4.2/crun 1.21 runtime:

- `template:smoke --restore` passed in 45.7 seconds. The ignored manifest
  `tmp/template-smoke-MS7mHM/result.json` records schema/data hashes, successful
  migrations and password authentication continuity, encrypted canary byte equality
  and source deletion before restore, authenticated decryption, and missing/wrong-key
  rejection. The synthetic TOTP-v1 key-continuity checks also passed.
- `node tmp/run-template-checks.cjs api-e2e:e2e` passed in 1 minute 3 seconds
  with private Redis: 24 memory-backed HTTP tests in 6 suites plus 4 durable
  sync-restart/device-approval tests in 2 suites using real PostgreSQL/MinIO.
  The local runner now binds published ports only to `127.0.0.1`.
- Images were explicitly downloaded: `docker.io/library/postgres:16-alpine`
  (PostgreSQL 16.15), `docker.io/library/redis:7-alpine`, and
  `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`.

For future runs, reserve the full-server slot and use the per-shell setup and
explicit image provisioning in [the restore runbook](restore.md#real-container-acceptance-2026-09-22).
It documents the existing ignored, machine-local wrappers and API runner. After
that setup:

```sh
pnpm nx run server:build:production
pnpm nx run template:smoke --restore
node tmp/run-template-checks.cjs api-e2e:e2e
```

**Superseded runtime diagnosis:** the earlier `docker info` error,
`default OCI runtime "crun" not found: invalid argument`, was misleading: crun was
already installed. Default runtime configuration remains broken against stale
`/run/user/1000` state. The accepted workaround uses wrapper flags for workspace
`tmp/restore-podman-storage`, runroot `/tmp/opencode/restore-podman-run-home`,
`vfs`, explicit `/usr/bin/crun`, `cgroupfs`, and file events, with per-shell PATH
and cleared container connection overrides.

Acceptance proves database and synthetic recovery fixtures, not full product vault
recovery, product TOTP login after recovery, or production key escrow. Real
PostgreSQL multi-connection races are not automatically covered by these runs.
Physical passkeys, real provider flows, synchronized credentials, hardware Safari,
and human visual/accessibility acceptance remain separate checks; follow
[the real-device validation guide](auth-real-device-validation.md).
