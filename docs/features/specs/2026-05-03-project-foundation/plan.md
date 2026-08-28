# Project Foundation — Implementation Plan

## Data Model

### `projects`

| Column             | Type              | Notes                              |
| ------------------ | ----------------- | ---------------------------------- |
| id                 | uuid (PK)         |                                    |
| name               | text              | Human-readable                     |
| slug               | text              | UNIQUE, URL-safe                   |
| summary            | text              | Short operational description      |
| status             | text              | 'draft' \| 'active' \| 'archived'  |
| source_type        | text              | 'manual' \| 'seeded' \| 'imported' |
| created_by_user_id | uuid (FK → users) |                                    |
| created_at         | timestamp         |                                    |
| updated_at         | timestamp         |                                    |

### `project_context`

| Column                          | Type                 | Notes                                      |
| ------------------------------- | -------------------- | ------------------------------------------ |
| id                              | uuid (PK)            |                                            |
| project_id                      | uuid (FK → projects) |                                            |
| source                          | text                 | 'agent_seed' \| 'manual_edit' \| 'refresh' |
| version                         | integer              |                                            |
| stack_summary                   | text                 |                                            |
| architecture_summary            | text                 |                                            |
| commands_json                   | jsonb                | build, test, lint, dev commands            |
| environment_summary             | text                 |                                            |
| deployment_summary              | text                 |                                            |
| recommended_next_steps_markdown | text                 |                                            |
| created_at                      | timestamp            |                                            |
| updated_at                      | timestamp            |                                            |

V1: one current active row per project. Version history deferred.

### `project_documents`

| Column             | Type                 | Notes                                                                                             |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| id                 | uuid (PK)            |                                                                                                   |
| project_id         | uuid (FK → projects) |                                                                                                   |
| title              | text                 |                                                                                                   |
| document_type      | text                 | 'brief' \| 'overview' \| 'architecture' \| 'setup' \| 'operational_notes' \| 'imported_reference' |
| status             | text                 | 'draft' \| 'active' \| 'archived'                                                                 |
| content_markdown   | text                 |                                                                                                   |
| source             | text                 |                                                                                                   |
| created_by_user_id | uuid (FK → users)    |                                                                                                   |
| created_at         | timestamp            |                                                                                                   |
| updated_at         | timestamp            |                                                                                                   |

### `project_decisions`

| Column                | Type                 | Notes                                                  |
| --------------------- | -------------------- | ------------------------------------------------------ |
| id                    | uuid (PK)            |                                                        |
| project_id            | uuid (FK → projects) |                                                        |
| title                 | text                 |                                                        |
| summary               | text                 |                                                        |
| status                | text                 | 'proposed' \| 'accepted' \| 'superseded' \| 'rejected' |
| context_markdown      | text                 |                                                        |
| decision_markdown     | text                 |                                                        |
| consequences_markdown | text                 |                                                        |
| created_by_user_id    | uuid (FK → users)    |                                                        |
| created_at            | timestamp            |                                                        |
| updated_at            | timestamp            |                                                        |

## API Endpoints

| Method | Path                                 | Purpose                |
| ------ | ------------------------------------ | ---------------------- |
| POST   | `/api/projects`                      | Create project         |
| GET    | `/api/projects`                      | List projects          |
| GET    | `/api/projects/:projectId`           | Get project detail     |
| GET    | `/api/projects/:projectId/context`   | Get project context    |
| PUT    | `/api/projects/:projectId/context`   | Upsert project context |
| GET    | `/api/projects/:projectId/documents` | List documents         |
| POST   | `/api/projects/:projectId/documents` | Create document        |
| GET    | `/api/projects/:projectId/decisions` | List decisions         |
| POST   | `/api/projects/:projectId/decisions` | Create decision        |

## Implementation Steps

1. Define Drizzle schema for all four entities
2. Generate and apply migrations
3. Implement project service layer (CRUD, context upsert)
4. Implement document service layer (create, list)
5. Implement decision service layer (create, list)
6. Build API route handlers with Zod validation
7. Build Angular projects overview page
8. Build Angular project detail page
9. Build Angular project document detail page
10. Build Angular project new/create form
11. Wire MCP endpoint for agent-driven seeding

## Angular Routes

| Path                                        | Component         |
| ------------------------------------------- | ----------------- |
| `/app/projects`                             | Projects overview |
| `/app/projects/new`                         | Create project    |
| `/app/projects/:projectId`                  | Project detail    |
| `/app/projects/:projectId/documents/:docId` | Document detail   |

## Seeding Flow

1. Agent/MCP calls `POST /api/projects` or uses existing project
2. Agent/MCP calls `PUT /api/projects/:projectId/context` with discovered data
3. Agent/MCP optionally creates documents via `POST /api/projects/:projectId/documents`
4. Agent/MCP optionally creates decisions via `POST /api/projects/:projectId/decisions`
