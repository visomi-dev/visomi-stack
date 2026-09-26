# PR 1 authentication review remediation

## Scope

This checkpoint addresses the two P1 and twelve P2 findings reviewed against
`ab9c89e`. Changes are local and have not been committed or pushed as part of this
checkpoint.

| Finding                                                    | Correction                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Email recovery bypassed enrolled TOTP                      | Require a current TOTP or single-use recovery code for enrolled identities; recheck enrollment policy when activating replacement passkeys. |
| Restricted account selection renewed invalidated authority | Preserve and validate the original proof epoch and verified identity before selecting an account and logging in again.                      |
| Password reset allowed unbounded TOTP attempts             | Reserve attempts atomically, enforce user/IP budgets, consume proofs transactionally, and reject TOTP replay.                               |
| Google unlink lacked fresh proof                           | Require a verified single-use `google_unlink` grant and request it through the contextual confirmation UI.                                  |
| Recovery issuance bypassed delivery limits                 | Apply normalized destination/IP quotas and a shared destination cooldown before invalidating challenges or sending email.                   |
| Resent email codes revived expired password proof          | Require an unexpired, nonterminal, session-bound password flow with a matching identity epoch at completion.                                |
| Recovery codes could not complete password sign-in         | Support atomic recovery-code completion and expose that method in the TOTP sign-in flow without removing TOTP.                              |
| TOTP setup rejected offered confirmation methods           | Consume the `totp_change` operation grant supplied by the confirmation dialog.                                                              |
| Email-verification link left the localized app             | Use Angular RouterLink.                                                                                                                     |
| Account loading failure repeated a consumed OTP            | Persist verification success separately and retry only account loading.                                                                     |
| Password Unicode bounds differed between layers            | Share NFC-normalized code-point validation for 12–128 characters; remove native limits that truncated valid passwords.                      |
| Mobile home links had no accessible name                   | Keep localized accessible labels at all viewport sizes.                                                                                     |
| Production Compose built localhost canonical URLs          | Require and forward `SITE_URL` as a Docker build argument; document rebuilding after origin changes.                                        |
| Normal smoke failed without cached container images        | Use `--pull=missing` for ordinary smoke; retain `--pull=never` for offline restore.                                                         |

Independent review also found a user/recovery-code lock inversion between
regeneration and anonymous verification. Regeneration now hashes outside its
transaction and locks the user before deleting codes. A separate-connection
PostgreSQL regression observes the expected blocking order and successful
completion of both operations.

## Verification

Each shell loads Node through `fnm` and exports `NX_DAEMON=false` and
`XDG_RUNTIME_DIR=/tmp/opencode` before invoking Nx.

| Verification                                                                           | Observed result                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nx run api:test` with `AUTH_LOCK_TEST_DATABASE_URL` pointing to owned PostgreSQL | 207 tests across 25 suites passed, including the multi-connection regression.                                             |
| Real Redis opt-in `redis-security.spec.ts`                                             | 8 tests passed against the exported production limiter functions and Lua scripts.                                         |
| `pnpm nx run app:vite:test`                                                            | 149 passed; 1 existing JSDOM skip.                                                                                        |
| Sequential `app-e2e:e2e`, `site-e2e:e2e`, `api-e2e:e2e`, `server-e2e:e2e`              | 73 app, 7 site, 24 HTTP API, 4 durable API, and 5 gateway tests passed: 113 total.                                        |
| `pnpm nx run template:test`                                                            | 24 passed.                                                                                                                |
| `pnpm nx run template:smoke` with initially empty isolated image storage               | Passed against real PostgreSQL; images were provisioned automatically. Evidence: `tmp/template-smoke-RxHUlN/result.json`. |
| `pnpm nx run template:smoke --restore`                                                 | Passed database and synthetic encrypted-object/key restore. Evidence: `tmp/template-smoke-DokQJF/result.json`.            |
| API, app, app-e2e, api-e2e, site, site-e2e, template lint                              | Passed.                                                                                                                   |
| App/site/template typechecks and localized builds through E2E prerequisites            | Passed.                                                                                                                   |
| Explicit `SITE_URL` Astro configuration probe                                          | Used the supplied HTTPS public origin.                                                                                    |

E2E and smoke fixtures now honor the server-provided email resend deadline and
obtain real operation grants. Assertions were preserved. Task-owned containers,
anonymous volumes, Redis processes, and gateway processes were cleaned up.

## Remaining boundaries

- Physical authenticators and real Google accounts still require the procedure in
  `auth-real-device-validation.md`; virtual browser tests do not establish hardware
  acceptance.
- The PostgreSQL regression is opt-in via `AUTH_LOCK_TEST_DATABASE_URL`. The Redis
  suite is opt-in via `AUTH_REDIS_INTEGRATION=1`, `DATABASE_DRIVER=pg`, `REDIS_URL`,
  and `AUTH_REDIS_OWNED_PID`. Its final test terminates the owned Redis process;
  run it only with disposable infrastructure owned by the test launcher.
- Redis command rejection fails closed. When the Redis connection is lost, the
  shared client currently retries indefinitely (`maxRetriesPerRequest: null`):
  no request was authorized during the outage probe, but bounded failure latency
  was not established. This shared-client availability behavior remains outside
  the fourteen corrected findings.
- Restore evidence covers synthetic recovery fixtures, not full product vault
  restoration or production key escrow.
