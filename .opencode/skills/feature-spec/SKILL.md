---
name: feature-spec
description: Kicks off a new feature by finding the next incomplete phase in docs/constitution/roadmap.md, creating a git branch, interviewing the user about scope/decisions/context, and writing a dated spec directory under docs/specs/ containing plan.md, requirements.md, and validation.md. Trigger when the user says "feature spec", "next phase", "start the next feature", or invokes /feature-spec.
---

# Feature Spec

## Workflow

### 1. Find the next phase

Read `docs/constitution/roadmap.md`. The next phase is the first section whose items are all `[ ]`. Note its name to derive the branch and directory name.

### 2. Create the branch

Follow the project branch naming convention: `<verb>/OC/<description>` (see `AGENTS.md`).

```
git checkout -b feat/OC/<feature-name>
```

### 3. Interview the user — BEFORE writing any files

Ask the user exactly **3 questions**:

| Header        | Question focus                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| **Scope**     | What the feature collects, exposes, or does — fields, behaviour, data shape                |
| **Decisions** | Key implementation choices — storage, visibility, validation, UX pattern                   |
| **Context**   | Tone, constraints, or anything shaping the spec — copy style, stack limits, open questions |

Do **not** write any files until the user has answered all three questions.

### 4. Read guidance files

Read `docs/constitution/mission.md` and `docs/constitution/tech-stack.md` before drafting.

### 5. Create the spec directory

Name: `docs/specs/YYYY-MM-DD-<feature-name>/` using today's date.

#### `requirements.md`

- Scope section: what is and is not included; field/data table if applicable
- Decisions section: choices made and why (draw from user answers)
- Context section: tone rules, stack pointers, existing patterns to follow

#### `plan.md`

- Numbered task groups appropriate to the feature (for example: Data → Components → Page & Route → Navigation → Tests)
- Each group has numbered sub-tasks; groups should be independently implementable

#### `validation.md`

- Automated: project test and typecheck commands pass; specific assertions required
- Manual: walkthrough, behaviour, edge cases
- Tone check if the feature has user-facing copy
- Definition of done

### 6. Update the roadmap

Mark the relevant phase items as `[ ]` → `[ ]` (with link to the spec directory) in `docs/constitution/roadmap.md`.

## Constraints

- Respect the existing tech stack defined in `docs/constitution/tech-stack.md` — no new dependencies without user approval
- Follow existing conventions and patterns already established in the codebase
- Keep feature scope focused and independently shippable
- Branch naming: `feat/OC/<feature-name>` (see `AGENTS.md`)
- Version bump required in `apps/web/app/version.json` when source files change
