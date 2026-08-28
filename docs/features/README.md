# Feature Specifications

This directory is the core of Themis's spec-driven development (SDD) workflow.

## Structure

Each feature lives in its own dated folder under `specs/`:

```
features/specs/<date>-<topic>/
├── requirements.md    # WHAT the feature must do
├── plan.md            # HOW to implement it
└── validation.md      # HOW to verify it works
```

## When To Create A Spec

Create a feature spec **before** starting implementation when:

- The feature has external behavior (user-facing or API)
- It involves new database tables or schema changes
- It requires coordination across multiple runtimes (API + worker + realtime)
- An AI agent will implement it

## How To Use A Spec

1. **Write the spec first** — define requirements, plan, and validation criteria before writing code
2. **Reference it from AI prompts** — point agents at `docs/features/specs/<spec>/requirements.md`
3. **Keep it updated** — as implementation reveals new constraints, update the spec (spec-anchored development)
4. **Validate against it** — before marking a feature complete, run through `validation.md`

## Spec Content Guidelines

- Requirements: user stories, acceptance criteria, scope (in/out), edge cases
- Plan: implementation steps, data model changes, route design, migration order
- Validation: test scenarios, manual checks, automated test commands

Favor lightweight, evolving specs over exhaustive ones. The cost of refining the spec should be lower than the cost of fixing misunderstandings in implementation.
