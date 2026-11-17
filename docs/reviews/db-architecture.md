# Database architecture alignment — VIS-65–74 and VIS-78

This review covers the persistence implementation already merged through PR #24
and its follow-up in PR #25. It addresses the requested runtime boundaries,
Angular conventions and backend database extraction. It does not authorize merge,
deployment, live migrations, provider changes or privacy publication.

## Findings and resolutions

| Finding                                                                                                         | Resolution                                                                                                                                                                                                                                                                                                 | Relevant issues                        |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Angular member groups ignored visibility for signals/injection, so mixed public/private properties passed lint. | Class groups now include visibility before Angular role. Regression cases exercise the reported example through root and project ESLint configs. Existing initializer dependencies retain ordering priority.                                                                                               | VIS-69, VIS-72, VIS-73                 |
| The example component owned HTTP, DTO parsing, route subscriptions and orchestration.                           | `DatabaseExample` binds the template to a route-scoped `ExampleWorkspace` service. Domain services own transport and validation; component transport injection is rejected for the repository's existing HTTP adapters.                                                                                    | VIS-69, VIS-72                         |
| The example duplicated navigation state maintained by the shared loader service.                                | Shared `Navigation` exposes current activity and a cancellation context as signals. It invalidates old contexts synchronously on navigation start; effects bind the reactive route. The loader uses that same service.                                                                                     | VIS-69, VIS-71, VIS-72, VIS-73         |
| A signal-only deferred reset could leave an old context usable while a route guard is pending.                  | Synchronous cancellation remains at the navigation source. A real Router regression pauses a guard before change detection, checks lock/abort and rejects writes, then verifies canceled navigation requires another explicit unlock. Existing A/B, history and late-response assertions remain.           | VIS-69, VIS-71, VIS-73                 |
| Browser crypto/Dexie lived in a web-shared library and generic persistence names obscured boundaries.           | `shared-db` contains portable contracts; `web-frontend-db` owns browser adapters; application services live under `db/`. The separate browser storage entrypoint loads dynamically through `ClientDatabase`. HTTP paths, IDs and stored formats retain compatibility.                                      | VIS-65, VIS-68, VIS-69, VIS-71, VIS-72 |
| PostgreSQL resources, schemas and migrations lived inside backend-shared.                                       | `backend-db` owns those resources and consumes shared-db contracts. Backend-shared retains general injection/mail/realtime utilities. Executables still create/close pools explicitly.                                                                                                                     | VIS-66, VIS-67, VIS-78                 |
| Extraction could break migration paths, the production pre-deploy command or affected CI selection.             | Development/isolated tests use backend-db targets. Runtime image keeps the existing provider path as a symlink to the canonical migrator. Container checks exercise both paths with absent credentials, without connecting. CI/development inputs and isolated migration fixtures reference the new owner. | VIS-67, VIS-73, VIS-78                 |

## Dependency and lifecycle decisions

- `shared-db` has no DOM/Node/Angular/Dexie/Drizzle runtime and no platform adapter
  dependency. Both runtime adapters consume its contracts.
- `backend-db` uses the existing `InjectionToken` primitive from `backend-shared`.
  There is no reverse production dependency or compatibility re-export. Nx checks
  detect cycles and constrain backend/shared/frontend scopes.
- `web-frontend-db` uses browser Web Crypto, WebAuthn and IndexedDB. Dexie is
  confined to its storage entrypoint; Angular stays in the consuming application.
  The API integration fixture imports erased browser types and executes adapter
  code in Chromium, never in its Node server.
- Navigation locks even when canceled or when only query parameters change.
  Requests already dispatched may finish for their original target; responses
  cannot publish into another context. No abort/reset clears persisted encrypted
  outboxes, trusted checkpoints, key budgets or live server state.
- Schema, AEAD, authorization, retention/receipt floors and rollback checks are
  retained. SQL migrations and public crypto vector files are moved byte-for-byte.
  No new dependency or database migration is introduced by this alignment.
- The runtime migration symlink is a compatibility measure for the existing IaC
  command. Removing it requires a separately authorized provider configuration
  update; this is not a development blocker.
- The checked-in Railway watch list includes `/libs/backend/db/**`,
  `/libs/shared/db/**` and `/libs/web/frontend/db/**`. Applying the reviewed settings
  to the live provider remains part of a separately authorized release. Until then,
  live build selection may omit library-only commits. Local development and GitHub
  CI selection already include the new libraries.

## Verification record

Final local validation passed all 66 Nx tasks across 15 projects: lint,
types, test types, email/deployment/vector checks, application builds and all 13 unit
and integration test projects (1,159 tests). Angular passed 186, the browser SDK 70,
the API 354 and backend-db 10. API and backend per-file coverage requirements remain
at 100%. The 35 ESLint regression cases also passed. The first full run exposed one
fixture assertion still expecting the old migration folder; its path was corrected,
then the complete check passed. Commit hooks subsequently exposed inconsistent
backend import grouping between root and project cwd. Two isolated-process
regressions reproduced it and passed after explicit alias classification. The
complete final check is repeated on the committed code before publication.
Published-head CI and E2E evidence are recorded
in PR #25 and the linked Linear updates.
The extraction comparison found all 16 SQL/snapshot files and all three public
vector fixture files byte-identical to the prior committed versions. An AST
comparison of 41 relocated runtime files (contracts, crypto, database and API
services) found no non-import changes.

Full checks preserve existing tests, assertions, per-file coverage requirements
and hooks. Regression coverage also verifies database injection identity across
independent resources and the relocated migration command on an isolated database.

## Remaining implementation limits and release gates

The previous [security review](persistence-milestone.md) remains applicable. The
architecture changes do not supply a complete device administration UI or an
authenticated current-state bootstrap after history compaction. Expired-horizon
clients keep their pins/outboxes and fail closed; historical key grants disclose
older revisions in the granted key scope. These are explicit implementation limits,
not silent acceptance of unauthenticated snapshots or revoked access.

Independent cryptographic review and global multi-device nonce accounting remain
release gates. Product owners must decide Nive recovery actors/custody/consent;
operations owners must approve retention, backup erasure and maintenance schedules;
privacy owners must approve any public policy. Native applications and unsupported
PRF browser/device combinations remain unimplemented or unverified. Passing tests
is not independent audit, production security approval or permission to publish.
