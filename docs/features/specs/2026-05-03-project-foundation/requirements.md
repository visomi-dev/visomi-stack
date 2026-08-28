# Project Foundation — Requirements

## Feature

Create, seed, and display projects with structured context, documents, and decisions.

Source docs: [product/prd.md](../../product/prd.md), [architecture/backend/project-foundation.md](../../architecture/backend/project-foundation.md)

## User Stories

1. As a user, I can create a project manually (name, slug, summary)
2. As a user, an agent/MCP can seed a project with discovered context
3. As a user, I can view a projects list showing name, status, and activity
4. As a user, I can view a project detail with context, documents, and decisions
5. As a user, I can create project documents (brief, overview, architecture, setup, notes)
6. As a user, I can create and track project decisions (proposed, accepted, superseded, rejected)

## Acceptance Criteria

### Project CRUD

- [ ] Create project via `POST /api/projects`
- [ ] List projects via `GET /api/projects`
- [ ] Get project detail via `GET /api/projects/:projectId`
- [ ] Project has name, slug, summary, status (draft/active/archived), source_type

### Project Context

- [ ] Get context via `GET /api/projects/:projectId/context`
- [ ] Upsert context via `PUT /api/projects/:projectId/context`
- [ ] Context stores: stack, architecture, commands (JSON), environment, deployment, next steps (markdown)
- [ ] One current active context row per project
- [ ] Context includes source (agent_seed/manual_edit/refresh) and version

### Project Documents

- [ ] List documents via `GET /api/projects/:projectId/documents`
- [ ] Create document via `POST /api/projects/:projectId/documents`
- [ ] Document has title, type (brief/overview/architecture/setup/operational_notes/imported_reference), status, markdown content
- [ ] Documents render as markdown in the UI

### Project Decisions

- [ ] List decisions via `GET /api/projects/:projectId/decisions`
- [ ] Create decision via `POST /api/projects/:projectId/decisions`
- [ ] Decision has title, summary, status (proposed/accepted/superseded/rejected), context, decision body, consequences (all markdown)

## Scope

### In Scope

- Four entities: projects, project_context, project_documents, project_decisions
- Agent-driven seeding (MCP → API → create/update records)
- Manual project creation and editing
- Project overview list view
- Project detail view with tabs/sections

### Out of Scope

- Tasks / task execution layer
- Deep file indexing
- Complex sharing permissions
- Project templates
- Full import job orchestration

## Edge Cases

- Seeding a project that already exists: update context, don't duplicate
- Empty projects list: show empty state with create/seed CTA
- Document with no content: show placeholder state
- Slug collision: append suffix or return error
