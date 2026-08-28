# Docs

Documentation for Themis organized for spec-driven development (SDD).

## Structure

```
docs/
├── constitution/          # Mission, tech stack, roadmap
├── product/               # Product definition (WHAT the system does)
├── features/specs/        # Feature specifications (SDD core)
├── architecture/          # System design and decisions (HOW it's built)
│   ├── system/            # System-level architecture
│   ├── backend/           # Backend patterns and data models
│   ├── frontend/          # Frontend architecture and conventions
│   └── adr/               # Architecture Decision Records
├── design/                # Visual exploration, prompts, reference assets
├── testing/               # Test strategies and coverage docs
└── sessions/              # Working notes from reviews and assessments
```

## Constitution

Core documents that define what Themis is and where it's going.

- [Mission & Principles](constitution/mission.md)
- [Tech Stack](constitution/tech-stack.md)
- [Roadmap](constitution/roadmap.md)

## Product

User-facing product definition — the user experience, workflow, and feature design.

- [PRD](product/prd.md)
- [UX Model](product/ux-model.md)
- [Workflow](product/workflow.md)
- [Auth Flow](product/auth-flow.md)
- [First-Run Activation](product/onboarding-activation-prd.md)
- [UI Exploration — Project Foundation](product/ui-exploration-project-foundation.md)
- [Agent Integration](product/agent-integration.md)

## Feature Specifications

Spec-driven development specs. Each feature has requirements, implementation plan, and validation criteria.

- [How to use features/](features/README.md)
- [Auth](features/specs/2026-05-auth/)
  - [Requirements](features/specs/2026-05-auth/requirements.md)
  - [Plan](features/specs/2026-05-auth/plan.md)
  - [Validation](features/specs/2026-05-auth/validation.md)
- [Project Foundation](features/specs/2026-05-project-foundation/)
  - [Requirements](features/specs/2026-05-project-foundation/requirements.md)
  - [Plan](features/specs/2026-05-project-foundation/plan.md)
  - [Validation](features/specs/2026-05-project-foundation/validation.md)
- [First-Run Activation](features/specs/2026-05-first-run-activation/)
  - [Requirements](features/specs/2026-05-first-run-activation/requirements.md)
  - [Plan](features/specs/2026-05-first-run-activation/plan.md)
  - [Validation](features/specs/2026-05-first-run-activation/validation.md)

## Architecture

### System

- [System Architecture Overview](architecture/system/overview.md)
- [Multi-Tenant Architecture](architecture/system/multi-tenant.md)
- [Deployment Model](architecture/system/deployment.md)
- [Runtime Boundaries](architecture/system/runtime-boundaries.md)
- [Operational Workspace Foundation Audit](architecture/system/operational-workspace-foundation-audit.md)
- [Operational Workspace IA and UX Flows](architecture/system/operational-workspace-ia-ux-flows.md)

### Backend

- [Feature Pattern](architecture/backend/feature-pattern.md)
- [Content Model](architecture/backend/content-model.md)
- [Project Foundation Model](architecture/backend/project-foundation.md)
- [Auth Architecture](architecture/backend/auth.md)

### Frontend

- [Frontend Architecture Overview](architecture/frontend/overview.md)
- [Angular App Conventions](architecture/frontend/angular-conventions.md)

### ADRs

- [ADR Index](architecture/adr/README.md)
- [ADR 001 — First-Run Activation Frontend](architecture/adr/001-first-run-activation-frontend.md)
- [ADR 002 — First-Run Activation Backend](architecture/adr/002-first-run-activation-backend.md)

## Design

- [Visual Discovery](design/visual-discovery.md)
- [Design System Reference](design/design-system-reference.md)
- [Design Prompts](design/prompts/)
- [Reference Assets](design/assets/)

## Testing

- [Auth Testing Strategy](testing/auth-testing.md)

## Guides

- [Local OpenCode Control Plane](guides/local-opencode-control-plane.md)

## Sessions

Working notes from architecture reviews, tool assessments, and PR reviews. Not formal specs.

- [Session Notes](sessions/README.md)
