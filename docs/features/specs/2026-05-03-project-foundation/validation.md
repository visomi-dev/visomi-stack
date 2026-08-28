# Project Foundation — Validation

## Automated Tests

### API E2E

```bash
pnpm exec nx run api-e2e:e2e
```

Must cover:

- Create project with valid payload
- Create project with duplicate slug → error
- List projects returns array
- Get project by ID
- Upsert project context
- Create and list project documents
- Create and list project decisions

### Playwright E2E

```bash
pnpm exec nx run app-e2e:e2e
```

Must cover:

- `/app/projects`: list view with mock data
- `/app/projects/new`: create form submission
- `/app/projects/:projectId`: detail view with context, documents, decisions sections
- Empty state when no projects exist

## Manual Validation

### Prerequisites

Same as auth validation: running composed server with PostgreSQL and valid session.

### Checklist

**Project CRUD**

- [ ] Navigate to `/app/projects`, see project list
- [ ] Click "New Project", fill form, submit
- [ ] Confirm new project appears in list
- [ ] Click project, see detail page with context/docs/decisions tabs

**Context**

- [ ] Seed context via MCP or API
- [ ] Refresh project detail, see stack summary, architecture, commands
- [ ] Confirm context source and version are displayed

**Documents**

- [ ] Create a document via API with markdown content
- [ ] View document in project detail → documents tab
- [ ] Confirm markdown renders correctly

**Decisions**

- [ ] Create a decision via API (proposed status)
- [ ] View decision in project detail → decisions tab
- [ ] Confirm status badge and markdown rendering

**Agent Seeding**

- [ ] Run seed prompt through OpenCode/MCP
- [ ] Confirm project created with context populated
- [ ] Confirm documents created from discovered structure
