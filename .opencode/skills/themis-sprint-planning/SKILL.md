---
name: themis-sprint-planning
description: Use when turning defined Themis work items into a versioned sprint proposal with Why, What, How, dependencies, non-goals, and verification.
---

# Themis Sprint Planning

Before proposing a sprint:

1. Select the owning project.
2. Select one or more epics in that project.
3. Read the selected work items.
4. Confirm each item is `ready` and belongs to the selected project and epic set.
5. Add blocking dependencies explicitly with `themis_dependency_add`.
6. Define one measurable Sprint Goal.
7. Define Why, What, and How.
8. Define non-goals and Definition of Done.
9. Define sprint-level verification.

The Definition of Done must state that every selected work item has its
validation matrix satisfied. Sprint-level verification must include the
relevant unit, API/OpenAPI, app or gateway E2E, site E2E, visual screenshot,
security, and build checks. A selected implementation item without a selected
validation item is a planning defect; add the validation item and a blocking
dependency before proposing the sprint.

Use `themis_sprint_propose` with `projectId` and `epicIds`. Proposals are versioned; never overwrite a previous proposal. If exploration changes scope, create a new revision with `sprintId` and explain the delta in `planning/sprints/<sprint-id>/proposal.md`.

Planning does not activate a sprint and does not authorize implementation.
