# Project Foundation Model

## Purpose

Define the smallest backend content model that lets Themis support project seeding, project context, and durable documentation before task execution expands further.

This model is intentionally narrow.

It exists to support:

- first project creation
- first project seeding through an agent or MCP-driven flow
- project-level context review in the UI
- durable documentation tied to a project

It does not try to define the full long-term Themis schema.

## Principle

Start from the objects that must exist for the product to feel real.

For the first slice, those objects are:

- project
- project context
- project document
- project decision

These four entities are enough to:

- represent a project as a durable object
- store the important context the agent discovers
- preserve documentation without pushing everything into one markdown blob
- let the UI explore a real information architecture

## Canonical Direction

The database remains the canonical operational source.

Markdown remains the preferred long-form narrative format for documentation fields.

That means:

- structured fields live in tables
- long-form content is stored in the database as markdown text
- the frontend reads structured records, not filesystem files

## Entity 1: Projects

`projects` is the root object for the first product slice.

### Purpose

- represent one software project or workspace inside Themis
- provide the anchor for all context, documentation, and later tasks

### Minimum Fields

- `id`
- `name`
- `slug`
- `summary`
- `status`
- `source_type`
- `created_by_user_id`
- `created_at`
- `updated_at`

### Recommended Field Meaning

- `name`: human-readable project name
- `slug`: stable URL-safe identifier
- `summary`: short operational description
- `status`: lifecycle state such as `draft`, `active`, `archived`
- `source_type`: how the project entered Themis such as `manual`, `seeded`, `imported`

### Notes

The `projects` table should stay intentionally small. Rich context should not be pushed into it.

## Entity 2: Project Context

`project_context` stores the structured understanding of a project that comes from seeding or later refinement.

### Purpose

- capture the current operational understanding of a project
- support AI and human review without forcing them to parse scattered notes
- provide the data needed for a strong project detail page

### Minimum Fields

- `id`
- `project_id`
- `source`
- `version`
- `stack_summary`
- `architecture_summary`
- `commands_json`
- `environment_summary`
- `deployment_summary`
- `recommended_next_steps_markdown`
- `created_at`
- `updated_at`

### Recommended Field Meaning

- `source`: where the context came from such as `agent_seed`, `manual_edit`, `refresh`
- `version`: revision number for the project context snapshot
- `stack_summary`: short summary of framework, runtime, and package manager
- `architecture_summary`: concise narrative of the detected architecture
- `commands_json`: structured build, test, lint, dev commands
- `environment_summary`: narrative summary of required environment assumptions
- `deployment_summary`: narrative summary of deployment or runtime expectations
- `recommended_next_steps_markdown`: short actionable follow-up suggestions

### Notes

This table can be modeled as a current-state record or as append-only snapshots.

Recommended V1 direction:

- keep one current active row per project
- optionally add version history later if refresh and audit become important

## Entity 3: Project Documents

`project_documents` stores project-level long-form material.

### Purpose

- preserve durable project documentation inside Themis
- separate different document types instead of hiding everything in one field
- support a documentation-oriented UI

### Minimum Fields

- `id`
- `project_id`
- `title`
- `document_type`
- `status`
- `content_markdown`
- `source`
- `created_by_user_id`
- `created_at`
- `updated_at`

### Recommended Document Types

- `brief`
- `overview`
- `architecture`
- `setup`
- `operational_notes`
- `imported_reference`

### Recommended Status Values

- `draft`
- `active`
- `archived`

### Notes

This model gives the UI enough structure to show a document list, document detail view, and later document editing without needing a more complex CMS model.

## Entity 4: Project Decisions

`project_decisions` stores important project-level decisions independently from generic documents.

### Purpose

- preserve rationale clearly
- keep decision history queryable and scannable
- support future ADR-like views in the product

### Minimum Fields

- `id`
- `project_id`
- `title`
- `summary`
- `status`
- `context_markdown`
- `decision_markdown`
- `consequences_markdown`
- `created_by_user_id`
- `created_at`
- `updated_at`

### Recommended Status Values

- `proposed`
- `accepted`
- `superseded`
- `rejected`

## Relationships

Core relationships for the first slice:

- one project has one current project context
- one project has many project documents
- one project has many project decisions

Later relationships can add:

- tasks
- updates
- references
- external integrations
- members and permissions

## What Not To Model Yet

Do not introduce these in the first slice unless implementation forces them:

- deeply normalized repository file indexes
- generic block editors
- tags everywhere
- complex sharing permissions
- project templates as a top-level system
- full import job orchestration

Those would add structural weight before the core idea is validated.

## Seeding Flow Mapping

When a user seeds a project through OpenCode and MCP, the backend should be able to create or update these records.

Recommended result of a successful seed:

1. create project if missing
2. write or refresh project context
3. optionally create initial project documents
4. optionally create one or more project decisions if the seed identifies durable architectural choices

## API Shape Implication

This document is not the full API spec, but it suggests a minimal contract shape.

Likely first endpoints:

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/context`
- `PUT /api/projects/:projectId/context`
- `GET /api/projects/:projectId/documents`
- `POST /api/projects/:projectId/documents`
- `GET /api/projects/:projectId/decisions`
- `POST /api/projects/:projectId/decisions`

## Recommended V1 Outcome

If this model is implemented, Themis will have enough durable structure to:

- create a real projects overview
- show a meaningful project detail page
- render documentation as a first-class product feature
- support agent-driven seeding without inventing the full task system first
