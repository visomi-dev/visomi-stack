# Authentication lifecycle integration verification

## Integration checkpoint: 2026-09-21

The local lifecycle integration includes first-passkey authorization, last-access-method
protection, session management, profile preferences, verified email changes, and leaving
the selected workspace. Leaving preserves the global identity, other memberships, and
shared workspace data; ownership transfer is required where applicable.

### Security review corrections

- Passkey assertion authorization rechecks current credentials, counters, membership,
  authentication version, and enrollment grants within one database transaction.
  Revoked or expired grants cannot activate pending credentials, including grants
  consumed at the start of password, Google, or device-approved enrollment.
- Assertion, recovery, and access-method removal use account-before-user lock ordering.
  Session issuance retains the authentication version accepted by the transaction.
- Authenticated mutations reload persisted session state and deserialize the Passport
  identity after acquiring the session authority lease. Permission and operation checks
  use that refreshed state; nested guards preserve changes made within the lease.
- Session promotion and final response persistence complete before releasing the lease.
  Regression tests cover delayed writes, SID rotation, revocation, save failures, and a
  waiting same-SID request attempting to restore consumed reauthentication state.
- Existing-identity email recovery is bound to its original authentication version.
  Tests cover email-change races, session rotation, replay, grant invalidation, and
  preservation of new-user bootstrap behavior.

### Observed verification

All commands load Node through `fnm` and set `NX_DAEMON=false` and
`XDG_RUNTIME_DIR=/tmp/opencode` before invoking Nx.

| Check                            | Command                                                             | Result                                                                     |
| -------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Final API unit/integration tests | `pnpm nx run api:test --runInBand`                                  | 23 suites, 178 tests passed                                                |
| Shared, worker, and server tests | `pnpm nx run-many -t test -p api,shared,worker,server --parallel=2` | All four targets passed; API subsequently rerun after final fixes as above |
| App unit tests                   | `pnpm nx run app:vite:test --skipNxCache`                           | 134 passed, 1 existing skip                                                |
| Template/restore tests           | `pnpm nx run template:test`                                         | 24 passed, including 15 restore-related tests; build prerequisite passed   |
| Lint                             | `pnpm nx run-many -t lint -p api,shared,app,worker,server`          | All five passed; `api:lint` rerun after final backend changes              |
| App typecheck                    | `pnpm nx run app:typecheck`                                         | Passed                                                                     |
| Native localization extraction   | `pnpm nx run app:extract-i18n`                                      | Passed; 494 messages extracted                                             |
| Localized production app build   | `pnpm nx run app:build --skipNxCache`                               | Passed without missing translations                                        |
| Final browser E2E                | `node tmp/run-template-checks.cjs app-e2e:e2e server-e2e:e2e`       | App: 70 passed; server: 5 passed                                           |

The final browser run executed sequentially with private Redis against the composed
gateway and a rebuilt API production bundle. App coverage includes 64 Chromium,
3 Firefox fallback, and 3 WebKit fallback tests. All eight prerequisite build tasks
succeeded. Ports 8080, 8081, and 4318 were free afterward, and task-owned Redis,
gateway, worker, and browser processes were cleaned up. The `tmp` runner is a local,
unversioned verification helper; canonical Nx targets remain `app-e2e:e2e` and
`server-e2e:e2e` with the dependencies described in `docs/agents/e2e.md`.

## Real-container acceptance checkpoint: 2026-09-22

Verification on `main` passed using isolated rootless Podman 5.4.2 and crun 1.21:

| Check                            | Command                                        | Result                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database and synthetic restore   | `pnpm nx run template:smoke --restore`         | Passed in 45.7 seconds                                                                                                                                             |
| API HTTP and durable integration | `node tmp/run-template-checks.cjs api-e2e:e2e` | Passed in 1 minute 3 seconds: 24 memory-backed HTTP tests in 6 suites, plus 4 durable sync-restart/device-approval tests in 2 suites against real PostgreSQL/MinIO |

The API runner uses private Redis and now binds published container ports only to
`127.0.0.1`. Images were explicitly downloaded: PostgreSQL `16-alpine` (16.15),
Redis `7-alpine`, and MinIO `RELEASE.2025-09-07T16-13-09Z`.
The ignored restore manifest `tmp/template-smoke-MS7mHM/result.json` records
schema/data hashes, successful migration and password-authentication continuity
checks, and an encrypted canary with matching restored bytes, source deletion
before restore, authenticated decryption, and missing/wrong-key rejection. The
synthetic TOTP-v1 fixture passed the same decryption and key-rejection checks.

The isolated runtime uses workspace `tmp/restore-podman-storage`, runroot
`/tmp/opencode/restore-podman-run-home`, `vfs`, explicit `/usr/bin/crun`, `cgroupfs`,
and file events. The existing ignored `docker`/`podman` wrappers and API runner
are machine-local, unversioned helpers. See [the restore runbook](restore.md#real-container-acceptance-2026-09-22)
for reproducible commands, per-shell PATH setup, and connection-override cleanup.

### Superseded acceptance blocker

The 2026-09-21 checkpoint did not execute PostgreSQL/MinIO restore acceptance or
the container-backed `api-e2e:e2e` target. Both passed on 2026-09-22. The previous
missing-`crun` diagnosis was misleading: crun was installed. Default runtime
configuration remains broken against stale `/run/user/1000` state; the isolated
wrapper configuration enabled acceptance.

### Remaining acceptance limits

- Real PostgreSQL multi-connection contention and authorization races are not
  automatically covered by the successful container-backed runs. PGlite
  interleavings do not prove those multi-connection behaviors.
- Physical passkeys, real Google/provider flows, synchronized credentials, hardware
  Safari behavior, and human visual/accessibility acceptance remain manual checks;
  follow [the real-device validation guide](auth-real-device-validation.md).
- The existing app test skip concerns JSDOM parsing Tailwind color expressions.
  Localization extraction reports whitespace-only duplicate-ID warnings for
  `securityKeepAccessMethod` and `securityFirstPasskeyIdentity`; the Spanish catalog
  remained unchanged during extraction and the localized build passed.
- Restore tests cover synthetic encrypted canaries and TOTP key continuity, not full
  product vault recovery or production key escrow.

No commit, push, or deployment was performed during this integration checkpoint.
