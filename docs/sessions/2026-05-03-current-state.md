# Themis Current State And Tomorrow Focus

**Date:** 2026-05-03

**Purpose:** Capture the current implementation state, visible gaps, and a focused plan for the next work session without relying on chat history.

---

## High-Level Product Focus

Themis is currently in the **activation + project foundation** slice.

The immediate goal is not DORA metrics, task CRUD, or dashboards yet. The immediate goal is to make the first useful loop coherent:

1. A user signs in.
2. The user reaches activation.
3. The user creates an API key.
4. The user receives honest, copy-paste-ready agent setup instructions.
5. The user creates or seeds a project.
6. The project detail page shows useful project context, documents, and seed status.

This slice should prove that Themis can connect human project setup with agent-assisted project understanding.

---

## Repository State Observed

- Repository path: `/home/visomi/Projects/GitHub/visomi-dev/themis`
- Current branch: `feat/webapp-activation-projects`
- Git status observed: clean
- Current repo shape: Nx monorepo

Main apps and packages:

- `apps/web/site` — Astro public site
- `apps/web/app` — Angular product app
- `apps/web/api` — Express API
- `apps/worker` — BullMQ worker runtime
- `apps/web/realtime` — Socket.IO realtime runtime
- `apps/web/server` — gateway/composition server
- `libs/shared` — shared infrastructure: database, sessions, logger, Redis, HTTP utilities
- `libs/projects` — project domain contracts and service logic

Recent work indicates the current branch has focused on auth, app shell, activation, and project foundation.

---

## Implemented Backend Capabilities

Current backend tables/entities include:

- `users`
- `accounts`
- `account_memberships`
- `user_sessions`
- `auth_verification_challenges`
- `user_devices`
- `api_keys`
- `user_activation_milestones`
- `projects`
- `project_documents`
- `async_jobs`

Important backend files:

- `libs/shared/src/lib/db/schema.ts`
- `apps/web/api/src/app.ts`
- `apps/web/api/src/auth/auth-middleware.ts`
- `apps/web/api/src/activation/activation-router.ts`
- `apps/web/api/src/activation/activation-service.ts`
- `apps/web/api/src/projects/projects-router.ts`
- `libs/projects/src/lib/projects-service.ts`

Current activation API surface:

- `GET /api/activation`
- `POST /api/activation/api-keys`
- `POST /api/activation/milestones`
- `POST /api/activation/api-keys/:apiKeyId/revoke`

Current project API surface:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/documents`
- `GET /api/projects/:projectId/jobs`
- `POST /api/projects/:projectId/seed`

---

## Implemented Frontend Capabilities

Current Angular app has:

- Activation route/page
- API key creation form
- One-time plaintext key display
- Config copy tabs
- Seed prompt copy section
- Skip and continue actions
- Projects list page
- New project form
- Project detail page
- Project seed trigger
- App shell layout

Important frontend files:

- `apps/web/app/src/app/app.routes.ts`
- `apps/web/app/src/app/activation/activation.ts`
- `apps/web/app/src/app/activation/activation.html`
- `apps/web/app/src/app/shared/activation/activation.ts`
- `apps/web/app/src/app/projects/projects.ts`
- `apps/web/app/src/app/projects/project-new/project-new.ts`
- `apps/web/app/src/app/projects/project-detail/project-detail.ts`
- `apps/web/app/src/app/shared/projects/projects.ts`

Current E2E coverage includes:

- Activation screen loads after auth
- API infrastructure section appears
- API key generation displays a `thm_` key
- Workspace configuration section appears
- Seed configuration section appears
- Skip/continue navigates to projects
- Projects list empty state
- New project navigation
- Project creation
- Project deletion

---

## Important Gaps

### 1. Activation copy currently overpromises MCP

The product docs and UI mention OpenCode/MCP setup, but the current implementation appears to expose REST/session-backed project endpoints and copyable config snippets, not a real Themis MCP server yet.

Decision needed:

- Either make the activation page honest about the current REST/API-key setup, or
- Implement the minimum real MCP/API-key integration layer.

Recommended near-term answer: make activation honest first.

### 2. Milestone names are inconsistent

Docs mention:

- `api_key_created`
- `mcp_config_copied`
- `mcp_marked_connected`
- `seed_prompt_copied`
- `activation_skipped`

Code currently supports:

- `activation_completed`
- `activation_skipped`
- `api_key_created`
- `config_copied`
- `seed_prompt_copied`

This should be aligned before more analytics or activation decisions depend on it.

### 3. API keys exist but agent/API-key auth is not clearly wired into project endpoints

API keys can be created and revoked, but project routes currently use session auth middleware.

Before external agents can use Themis cleanly, the backend likely needs API-key auth middleware that:

- reads `Authorization: Bearer thm_...`
- verifies the token hash against `api_keys`
- rejects revoked keys
- updates `lastUsedAt`
- attaches `accountId`, `userId`, and role/context to the request
- allows selected routes to accept either session auth or API-key auth

This is likely a better foundation than building MCP first.

### 4. Project context table is documented but not implemented

`docs/architecture/backend/project-foundation.md` recommends `project_context`, but current schema only includes `projects` and `project_documents` for project knowledge.

This is fine for now, but the next project-foundation backend step could be:

- `project_context`
- `GET /api/projects/:projectId/context`
- `PUT /api/projects/:projectId/context`

### 5. Project decisions are documented but not implemented

`project_decisions` are part of the project foundation model but are not in the current schema yet.

This should wait until activation and seed flow are coherent.

### 6. Task system has not started yet

No task table/entity was observed.

Do not start task CRUD until activation + project foundation is coherent.

### 7. DORA metrics should wait

No DORA/change/deployment/incident model is implemented yet.

This is good. DORA should guide the product later, but the current slice should remain focused on activation and project seeding.

---

## Recommended Focus For Tomorrow

### One-sentence objective

Make the activation page an honest, copy-paste-ready bridge between Themis and an agent.

### Definition of done

- Activation page does not overpromise real MCP if real MCP is not implemented.
- API key instructions are accurate.
- Seed prompt tells the agent exactly what to do.
- Milestone names are consistent between docs, schemas, backend, and frontend.
- User can still skip or continue to projects.
- Existing activation/project E2E expectations are updated if copy changes.

---

## Tomorrow Task Plan

### Task 1: Align activation terminology

**Goal:** Decide whether the page says `MCP setup`, `Agent setup`, or `REST API setup` for the current implementation.

Recommended decision:

- Use `Agent setup` as the section name.
- Mention REST/API-key support as currently available.
- Mention MCP as the next integration layer only if needed.

Files likely involved:

- `apps/web/app/src/app/activation/activation.html`
- `apps/web/app/src/app/activation/activation.ts`
- `docs/product/onboarding-activation-prd.md`
- `docs/architecture/adr/001-first-run-activation-frontend.md`

Acceptance criteria:

- A technical user can understand what is real today.
- The page still feels calm and copy-paste oriented.
- No section implies browser-side MCP verification.

---

### Task 2: Fix activation milestone naming

**Goal:** Make docs and code use the same milestone vocabulary.

Recommended vocabulary:

- `api_key_created`
- `agent_config_copied` or `mcp_config_copied`
- `seed_prompt_copied`
- `activation_completed`
- `activation_skipped`

If keeping MCP language, use `mcp_config_copied`.

If making the page more honest/generic, use `agent_config_copied`.

Files likely involved:

- `apps/web/api/src/activation/activation-service.ts`
- `apps/web/api/src/activation/activation-schemas.ts`
- `apps/web/app/src/app/activation/activation.ts`
- `apps/web/app/src/app/shared/activation/activation.models.ts`
- `docs/product/onboarding-activation-prd.md`
- `docs/architecture/adr/002-first-run-activation-backend.md`

Acceptance criteria:

- Milestone values are consistent in backend schemas, frontend models, and docs.
- Copying config records the intended milestone.
- Existing milestone history remains acceptable for local/dev data, or a migration/backward-compatibility decision is documented.

---

### Task 3: Improve the seed prompt

**Goal:** Make the copied seed prompt usable by an agent even before full MCP exists.

Recommended prompt behavior:

- Ask the agent to analyze the repo.
- Ask it to create a concise project setup summary.
- If API access is available, ask it to create/update the Themis project and documents.
- If API access is not available, ask it to return structured markdown for manual paste.

Files likely involved:

- `apps/web/api/src/activation/activation-service.ts`
- `apps/web/app-e2e/src/app/activation.spec.ts`

Acceptance criteria:

- Prompt includes clear fallback behavior.
- Prompt does not depend on unavailable MCP tools.
- E2E test still finds the expected seed prompt text, updated if necessary.

---

### Task 4: Add or update tests for activation copy

**Goal:** Keep the activation page stable after terminology changes.

Files likely involved:

- `apps/web/app-e2e/src/app/activation.spec.ts`
- Possibly frontend unit tests under `apps/web/app/src/app/activation/`

Acceptance criteria:

- Tests verify the new section title/copy.
- Tests verify API key creation still shows one-time token.
- Tests verify config and seed sections still exist.
- Tests verify skip/continue still navigate to projects.

---

### Task 5: Optional backend foundation if energy is high

**Goal:** Start API-key authentication for agent access.

Only do this if the activation copy/milestone work is finished and energy is good.

Potential implementation direction:

- Create reusable middleware for API-key auth.
- Allow selected routes to accept either session auth or API-key auth.
- Update `lastUsedAt` on successful API-key use.
- Add API tests.

Files likely involved:

- `apps/web/api/src/auth/auth-middleware.ts` or a new shared auth middleware file
- `apps/web/api/src/projects/projects-router.ts`
- `apps/web/api-e2e/src/api/...`
- `libs/shared/src/lib/db/schema.ts` if schema tweaks are needed

Acceptance criteria:

- `Authorization: Bearer thm_...` can authenticate a request to an allowed API endpoint.
- Revoked keys are rejected.
- Session auth continues to work.
- Tests cover success and failure cases.

---

## What Not To Do Tomorrow

Avoid these unless the activation slice is already coherent:

- Do not start task CRUD.
- Do not add DORA entities.
- Do not add initiatives.
- Do not redesign the whole UI.
- Do not implement full MCP before API-key/REST flow is clear.
- Do not create a complex onboarding wizard.

---

## Suggested Work Order

1. Read this document.
2. Open the activation page and inspect the current wording.
3. Decide `Agent setup` vs `MCP setup` terminology.
4. Align milestone names.
5. Improve the seed prompt.
6. Update tests.
7. Stop.

The successful day is a small coherent activation slice, not a large feature expansion.

---

## Future Direction After Tomorrow

Once activation is truthful and stable, the next sequence should be:

1. API-key auth for agent access.
2. Project context endpoint/table.
3. Agent-assisted project seeding writes structured project documents/context.
4. Project detail page shows context, documents, jobs, and next recommended actions.
5. Task CRUD begins only after project foundation is useful.
6. DORA/change/incident metrics come after task/update/change events exist.
