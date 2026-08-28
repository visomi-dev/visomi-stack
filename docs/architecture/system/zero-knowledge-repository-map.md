# Zero-Knowledge Migration Repository Map

## Purpose and scope

This map records the repository seams that later zero-knowledge work must use. It is a read-only inventory of the starter implementation, not a cryptographic design and not a claim that the planned agent modules already exist.

The map is cross-checked against ZK-001's Phase 0 classification and trust direction in [ADR 004](../adr/004-zero-knowledge-trust-foundation.md): `themis-agent` is the intended local plaintext authority; the cloud is an opaque orchestrator; the Angular product is a mediated consumer. The existing server-readable project flow is therefore a migration target, not the target architecture.

## Product boundary

### Public Astro website

The public website is the Astro application at `apps/web/site`.

- Route/content surfaces: `src/pages/`, `src/components/`, `src/layouts/`, and `src/content/`.
- Current routes include `/en/`, `/es/`, `/docs/`, and the locale-neutral redirect handled by the gateway.
- It is served for `/*` by `apps/web/server` after static assets are checked.
- Its current Nx boundaries are `site:build`, `site:serve`, `site:preview`, `site:typecheck`, `site:lint`, `site:test`, and `site-e2e:e2e`.
- It is not an authenticated project vault surface. No Astro vault UI is planned for v1 unless separately confirmed.

The Astro site should remain outside the encrypted product-context read path. Any future public documentation or marketing content must not become an accidental projection of protected project plaintext.

### Authenticated Angular product

The authenticated product is `apps/web/app`, served below `/app` by the gateway.

- Route boundary: `src/app/app.routes.ts`.
- Authenticated/activated product routes include dashboard, projects, new project, and project detail.
- Project UI and client data access live under `src/app/projects/` and `src/app/shared/projects/`.
- Project seed state is held in `src/app/shared/jobs/project-seed.ts` and receives Socket.IO events through `src/app/shared/realtime/browser-realtime.ts`.
- Current Nx boundaries are `app:build`, `app:serve`, `app:typecheck`, `app:lint`, `app:vite:test`, and `app-e2e:e2e`.

This is the product surface that will eventually consume an approved local-agent-mediated projection. Angular guards currently prove web authentication/activation, not device possession, project-key possession, or decryption authority.

### Supported local-agent endpoint boundary

For the current Angular visibility slice, the supported local-agent read endpoint is:

```text
GET http://127.0.0.1:4317/v1/product-visibility/projects/:projectId
```

`apps/web/app/src/app/shared/projects/local-agent-visibility.ts` is the sole browser-facing adapter for this boundary. The endpoint represents a local agent or equivalent loopback-mediated process that owns decryption and returns an approved projection. It is not an `apps/web/api` route, and Angular must not fall back to `/api/projects/:projectId` for protected context or activity. The cloud/API path remains an opaque metadata, authorization, and ciphertext-orchestration boundary; it is not plaintext authority for the displayed content.

The adapter maps local-agent transport outcomes to explicit product states: `423` is locked, `401`/`403` is unauthorized, loopback/network failure is unavailable, and other failures are error. The endpoint, port, authentication handshake, and production packaging remain subject to the local-agent transport decision in the later architecture work; this documented loopback URL is the supported repository boundary for the v1 Angular integration, not a claim that a dedicated `themis-agent` Nx project already exists.

## Gateway and cloud-orchestrator seams

`apps/web/server` is the public gateway, not a data authority. `src/gateway.ts` mounts:

```text
/api/*       -> apps/web/api
/app/*       -> Angular SSR/dev handler
/socket.io   -> realtime integration at the server boundary
/*           -> Astro SSR/static site
```

The cloud orchestrator is the existing composition of these runtime projects:

| Seam                                 | Current repository owner | Current responsibility                                                            | Migration constraint                                                                                                  |
| ------------------------------------ | ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| HTTP/auth                            | `apps/web/api`           | Express routers, sessions, tenant checks, project routes                          | Must validate account/device/capability metadata without becoming a plaintext reader                                  |
| Persistence/runtime primitives       | `libs/shared`            | Drizzle schema, PostgreSQL/PGlite, Redis, sessions, env, HTTP helpers             | Shared infrastructure can transport opaque records; protected content must not remain in generic readable fields      |
| Project domain contracts and records | `libs/projects`          | Project/document contracts, project service, async-job records, seed queue/events | This is the feature seam for versioned envelope and migration contracts; current records are readable text/state      |
| Background execution                 | `apps/worker`            | BullMQ bootstrap and project-seed worker                                          | Workers must process opaque envelopes or explicitly mediated operations, not project plaintext                        |
| Realtime delivery                    | `apps/web/realtime`      | Socket.IO auth, subscription, Redis-backed fanout                                 | Events and job payloads inherit the classification of their contents; sensitive narratives must be encrypted/redacted |
| Public composition                   | `apps/web/server`        | Gateway, headers, proxy/static/SSR wiring                                         | Must not expose a compatibility route that silently reinstates server-readable context                                |

Current graph dependencies are: `api -> projects -> shared`, `app -> projects`, `worker -> projects -> shared`, `realtime -> projects -> shared`, and `server -> shared`. The gateway build also explicitly builds `api`, `app`, `site`, `worker`, and `realtime`.

## Current data and read/write paths

### Project foundation

`libs/shared/src/lib/db/schema.ts` currently stores the following migration-relevant tables:

- `projects`: account-scoped name, slug, summary, status, source, and creator.
- `project_documents`: account/project-scoped title, type, status, and `content_markdown`.
- `async_jobs`: account/user/project-scoped type, status, progress, `input_json`, `result_json`, and `error_message`.

The repository's older project-foundation model also names `project_context`, but no `project_context` table or implementation was found in the inspected source. The current implementation instead puts the initial context draft into a project document during seeding. That distinction must remain explicit during migration.

### API read/write paths

`apps/web/api/src/projects/projects-router.ts` exposes the current server-readable surface:

- `GET /api/projects` -> `libs/projects` `listProjects()`.
- `GET /api/projects/:projectId` -> `getProject()`, which reads the project, documents, and async jobs together.
- `POST /api/projects` and `PATCH /api/projects/:projectId` -> project writes.
- `POST /api/projects/:projectId/documents` -> plaintext markdown document write.
- `GET /api/projects/:projectId/jobs` -> job read.
- `POST /api/projects/:projectId/seed` -> async seed enqueue.

The routes use account-aware session context, which is a tenant boundary but not a zero-knowledge boundary. `projects-service.ts` directly maps database text into API response contracts. These are the primary compatibility/migration seams.

### Seed, worker, and realtime path

The current flow is:

```text
Angular project detail
  -> POST /api/projects/:projectId/seed
  -> API creates async_jobs row and queues project-seed
  -> apps/worker runs libs/projects/src/lib/seed/service.ts
  -> worker updates async_jobs and writes a project document
  -> libs/projects publishes Redis event
  -> apps/web/realtime forwards job event to user room
  -> Angular updates local job signal and project detail
```

The job contract and event names are in `libs/projects/src/lib/contracts/async-jobs.ts` and `libs/projects/src/lib/seed/events.ts`. The current `input_json`, `result_json`, error text, document markdown, event message, and UI projection all require classification and redaction review; they must not be assumed safe merely because they are operational records.

## Intended future seams (not implemented here)

The following seams are required by ZK-001/ADR 004 but are not present as dedicated Nx projects or source modules in this starter repository:

| Intended seam                           | Placement/status for later work                                           | Boundary to preserve                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `themis-agent` local root of trust      | New local runtime/module; absent from current Nx graph                    | Own vault unlock, local plaintext reads/writes, key use, capability evaluation, and encryption/decryption |
| Crypto/envelope contracts               | Likely versioned shared contract seam, exact library unresolved           | Define serialized opaque envelopes and validation without choosing algorithms in this map                 |
| Opaque sync/cloud orchestrator          | Extend API/storage/worker/realtime contracts, not a new plaintext service | Cloud authenticates, routes, stores, and reports metadata/ciphertext only                                 |
| Device enrollment/revocation            | New agent/API contract seam; absent today                                 | Bind device identity and scoped key use; web session alone is insufficient                                |
| Capability evaluation and secret broker | Local-agent/MCP boundary; absent today                                    | Scope by account, project, device, purpose, audience, and expiry; never export root keys                  |
| Product mediated read                   | Angular client integration with a local agent or approved equivalent      | UI receives minimum authorized projection; no permanent server-readable fallback                          |
| Release/security assurance              | Release tooling/CI and verification work; no dedicated project identified | Signed builds, dependency review, redaction checks, and migration/threat-model verification               |

No crypto algorithm, key hierarchy, key storage mechanism, recovery protocol, metadata policy, or device protocol is selected by this document.

## Nx project and test boundaries

Focused later verification should use the smallest affected target:

| Change area                        | Focused projects/targets                                                                         | Existing test boundary                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Public Astro boundary              | `site:lint`, `site:typecheck`, `site:test`, `site:build`                                         | `site-e2e:e2e`                                    |
| Angular mediated read/UI           | `app:lint`, `app:typecheck`, `app:vite:test`, `app:build`                                        | `app-e2e:e2e`                                     |
| API contracts and migration routes | `api:lint`, `api:test`, `api:build`                                                              | `api-e2e:e2e`                                     |
| Gateway composition                | `server:lint`, `server:test`, `server:build`                                                     | `server-e2e:e2e`                                  |
| Opaque worker processing           | `worker:lint`, `worker:test`, `worker:build`                                                     | `worker-e2e:e2e`                                  |
| Opaque realtime events             | `realtime:lint`, `realtime:test`, `realtime:build`                                               | `realtime-e2e:e2e`                                |
| Shared records/contracts/schema    | `projects:lint`, `projects:test`, `projects:build`; `shared:lint`, `shared:test`, `shared:build` | Consumer runtime tests plus focused library tests |

The current unit-test split is Vitest for Astro/Angular and Jest for API, gateway, realtime, worker, and libraries. The project graph also contains `ui-designer`, but it is a prototype server and is not part of the product vault boundary.

## Gaps and decisions requiring confirmation

1. Confirm whether the missing `project_context` entity is intentionally replaced by versioned encrypted context envelopes or needs a transitional record.
2. Assign owners and deadlines for ADR 004's open decisions: metadata visibility, recovery actors, product read architecture, device enrollment/revocation, activity privacy, external-AI profiles, retention/deletion, key hierarchy/rotation, cloud search, and Phase 0 authority.
3. Define the exact local-agent transport (browser agent, daemon/IPC, or another mediated design), including offline behavior and browser-compromise assumptions.
4. Decide which job status/progress fields may remain cloud-readable and which job input/result/error/message fields require encrypted envelopes or redaction.
5. Inventory secondary plaintext copies in logs, queue payloads, backups, fixtures, e2e setup, error responses, and development seed data before changing the primary write path.
6. Confirm whether cloud object storage is needed for envelope payloads; no object-storage project or adapter was found in the current graph.
7. Confirm the release owner and required signed-build/dependency/security checks before the first cryptographic implementation lands.

## Non-goals

- No product code, integration, schema, crypto, key-storage, or routing changes are made by this map.
- No Astro vault UI is proposed for v1.
- Existing server-readable context/activity behavior is documented as a transition risk, not endorsed as the zero-knowledge end state.
