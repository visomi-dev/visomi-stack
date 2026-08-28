# Operational Workspace IA and UX Flow Specification

**Item:** `THM-OWV-002`
**Source of truth:** [Operational Workspace Foundation Audit](operational-workspace-foundation-audit.md) (`THM-OWV-001`)
**Status:** Phase-1 IA/UX contract for review; no Angular, API, prototype, or mutation implementation

## Intent and non-goals

The replacement authenticated surface is a read-only comprehension tool. It
helps an authorized person understand project context, attention, active work,
validation, review, and meaningful activity. It does not become an execution
console, sprint-management surface, cloud plaintext authority, or implicit
priority/mutation system.

## 1. Route and navigation model

The current Projects/Dashboard primary surface is replaced by a project-first
workspace. The route names below are the Angular replacement contract; they are
not implemented by this item.

| Entry point                              | Route                                          | Surface                                    | Deep-link and back behavior                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated landing / project switcher | `/projects`                                    | Project directory, not a dashboard summary | Stable URL; selecting a project navigates to `/projects/:projectId/workspace`.                                                                        |
| Project operational view                 | `/projects/:projectId/workspace`               | **Project Workspace** page                 | Project identity remains in the URL. Browser Back returns to the project directory or the prior external entry point.                                 |
| Work item inspection                     | `/projects/:projectId/work-items/:workItemId`  | **Work Item detail** page                  | Deep link resolves project membership before rendering. Back returns to the workspace attention/list context when available, otherwise the workspace. |
| Optional iteration context               | `/projects/:projectId/iterations/:iterationId` | Secondary, read-only iteration panel/page  | Never required to render workspace or work item detail. Back preserves the originating project context.                                               |
| Activity/timeline context                | `/projects/:projectId/timeline`                | Timeline page or workspace section         | Timeline links back to the referenced object; missing references remain inspectable as event records.                                                 |

### Navigation rules

1. The authenticated shell exposes **Projects** as the primary destination;
   “Dashboard” is not a parallel source of truth. A legacy dashboard link, if
   retained during migration, redirects to `/projects` without losing a
   project deep link.
2. A project route is the authority for project context. Work item detail is a
   child inspection route, not a second workspace.
3. Every object link carries stable IDs, never an array position or label.
4. Route resolvers/guards must distinguish `loading`, `locked`, `unavailable`,
   `stale`, `error`, and `not found`; they must not turn an unauthorized object
   into an empty state.
5. Query parameters may preserve view state (`attention`, `state`, `q`,
   `iteration`) but cannot encode mutations or claim authority.

## 2. Page, drawer, panel, and modal decisions

| Container | Use                                                                                                      | Decision and constraints                                                                                                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page      | A task with a durable URL, meaningful refresh/share/deep link, or enough content to orient independently | Workspace, work item detail, project directory, and timeline are pages. Each has one `h1`, a route-level loading/error boundary, and a meaningful mobile layout.                                                                                                                        |
| Drawer    | Contextual inspection that should preserve the user's list position                                      | Use for a quick evidence preview, actor/run summary, or timeline event preview from the workspace. Opening changes URL state when feasible; closing restores focus and the underlying position. Never put the only copy of a decision or blocker in a drawer.                           |
| Panel     | A stable region within a page or a responsive replacement for a drawer                                   | Use for attention reasons, current run, validation matrix, optional iteration context, and “what this means” explanations. Panels can collapse but their heading and state remain discoverable.                                                                                         |
| Modal     | A short, interruptive acknowledgement or protected-access explanation                                    | Use only for locked-access explanation, unavailable-source retry guidance, or destructive-looking confirmation copy if a later scope adds a mutation. No mutation modal is designed here. Modals trap focus, support Escape, and never contain protected preview when access is absent. |

### Above the fold

At desktop, the workspace shows, in order: project identity and freshness,
attention summary with reasons, active/blocked work summary, and the first
useful list of work items. Optional iteration context is secondary. At mobile,
the order is project identity, freshness, attention, blocked/active summary,
then work items; navigation controls remain reachable without horizontal
scroll.

Work item detail shows: title/identity, lifecycle state with human translation,
why it needs attention (if applicable), current run/review status, and the next
useful inspection link. Scope, acceptance criteria, dependencies, evidence,
timeline, and optional iteration follow in that order.

### Progressive disclosure

- First view: human meaning, causal reason, actor, timestamp, authority and
  freshness caveat, then a link to inspect.
- Second level: source record, dependencies, validation category, evidence
  pointer, review role/verdict, and translated event detail.
- Deep inspection: protected report/diff/screenshot content only after the
  authorized mediated read succeeds; otherwise show `Locked` with no preview.
- Never hide a state distinction behind a tooltip, color, icon-only control, or
  collapsed region. Collapsed regions retain accessible headings and status.
- Long evidence and timeline content is paginated or virtualized in the future;
  truncation must expose an explicit “show more” affordance and provenance.

## 3. Explicit no-sprint behavior

The workspace is useful when a project has no sprint, no board, no active
iteration, or an iteration source is unavailable. The primary hierarchy stays
project → attention → work items → runs/evidence/review → timeline. The UI says
“No iteration selected” or “This project has no iteration yet” and continues to
show project context, lifecycle states, blockers, execution, validation, and
review. It must not manufacture a default sprint, redirect to sprint setup, or
replace the workspace with a board empty state. If an iteration exists, it is a
filterable contextual panel and never the only route to work.

## 4. IA surface definitions

### Project Workspace

The workspace answers “What needs my inspection in this project, and why?”

1. Project identity: approved name/ID, visibility boundary, freshness, and
   source authority.
2. Attention: derived items with reason and source link; never a priority score
   or mutation affordance.
3. Work status: explicit blocked, in progress, review pending, accepted,
   rejected, rework, validated, and empty states.
4. Current execution: actor, run lifecycle, start/finish time, and latest
   evidence category.
5. Validation/review: category-scoped results and independent verdicts.
6. Activity: append-only, ordered, provenance-bearing event summaries.
7. Optional iteration: secondary context with an explicit no-sprint state.

### Work Item detail

The detail page answers “What is this item, what is stopping it, what evidence
exists, and what independent decision is pending?” It keeps intent and scope
near the top, then separates lifecycle from run state, evidence from review,
and current state from historical activity. A run finishing does not imply an
accepted work item; a failed validation does not itself imply blocked work; a
rejected review is not a validation failure.

## 5. Required flows and state contracts

Each flow below names the actor, and the machine-readable contract adds an
ordered `steps` sequence. Every step has an observable outcome, route, and
state so a reviewer can follow the flow without inferring behavior from prose.
The manifest also requires every flow to trace the complete phase-1 decision
set: vocabulary, trust, visual states, authority, translation, `OWV-D01`–
`OWV-D07`, and `OWV-R01`–`OWV-R03`. It also carries minimum data, observable
states, human translation, accessibility behavior, and
failure/locked/unavailable paths.
Machine-readable coverage is in
[`operational-workspace-flow-manifest.json`](operational-workspace-flow-manifest.json)
and is checked by `scripts/operational-workspace-ia-ux-flows.test.ts`.

| Flow                     | Actor and outcome                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enter project            | Authorized tenant member enters a project and gets a trustworthy orientation or an explicit access/source state.                                                                     |
| Find attention           | Authorized member follows a derived reason to the source work item without treating attention as priority or mutation.                                                               |
| Understand blocked work  | Member sees the causal blocker, authority, timestamp, dependency/decision, and next useful action.                                                                                   |
| See agent execution      | Member distinguishes active/finished run from work-item completion and can inspect actor/time/latest evidence.                                                                       |
| Inspect evidence         | Reviewer/verifier opens minimized evidence metadata and, only when authorized, its protected artifact.                                                                               |
| Decide review acceptance | Independent reviewer sees contract/evidence and records a verdict outside this read-only surface; the UI displays pending/accepted/rejected/rework without self-approval affordance. |
| Optional iteration       | Member filters or inspects iteration context, or continues normally with no sprint/iteration.                                                                                        |
| Trace timeline decisions | Member follows append-only events to objects, actor, time, and human translation, including redacted/missing references.                                                             |

### Shared state and accessibility contract

Every route and flow supports `loading`, `empty`, `locked`, `unavailable`,
`stale`, and `error` where the source can produce that condition. Domain states
also include `attention`, `blocked`, `in progress`, `validated`, `review
pending`, `accepted`, `rejected`, and `rework`. Every state has visible text,
non-color semantics, source/freshness context, and a live-region announcement
only for meaningful asynchronous changes. Pages use landmarks and heading
hierarchy; drawers/panels have labelled regions; modals have a dialog name,
focus return, Escape handling, and no protected preview when locked. Keyboard
focus is visible, all controls have names, lists expose item counts when known,
and color is never the sole state cue. Reduced motion does not remove state
meaning.

### Observable step contract

The eight required flows are executable documentation contracts, not implied
screen descriptions. Each `steps` entry is numbered from one without gaps and
must identify an action, what the person can observe, one of the declared
routes, and the resulting state. Negative fixtures reject an empty sequence,
duplicate or gapped ordering, missing observability, invalid routes, and a
flow that omits any phase-1 vocabulary/state decision. This keeps route/state
transitions and outcomes reviewable before Angular implementation.

## 6. Phase-1 traceability

Every one of the eight flows carries the complete trace set in the manifest;
the table below describes what that per-flow trace means rather than relying
on a package-level checklist.

| Per-flow trace key  | Required interpretation                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `vocabulary`        | Preserve project → epic/outcome → work item → run → evidence/review and activity/iteration relationships.      |
| `trust`             | Keep protected content mediated and unavailable while locked; do not imply cloud plaintext authority.          |
| `visual-states`     | Distinguish loading, empty, locked, unavailable, stale, error, and domain states with text and non-color cues. |
| `authority`         | Name source, actor, timestamp, and freshness; keep derived attention separate from authoritative lifecycle.    |
| `translation`       | Provide human meaning, causal context, and the next useful inspection action.                                  |
| `OWV-D01`–`OWV-D07` | Preserve each unresolved token, metadata, mediated-read, privacy, freshness, translation, and iteration gate.  |
| `OWV-R01`–`OWV-R03` | Preserve each plaintext-disclosure, visual-authority, and attention-as-priority risk.                          |

| Audit decision                          | IA/UX trace                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary and relationships (audit §1) | Route hierarchy, Workspace/detail separation, and flow names preserve project → epic → work item → run → evidence/review, with activity and optional iteration as distinct relationships. |
| Trust classification (audit §2)         | Page/drawer rules prohibit protected previews while locked; evidence and timeline disclosures require mediated authorization; routes never imply cloud plaintext authority.               |
| Visual states (audit §3)                | Shared state contract and all manifest flows require text, non-color cue, and explicit distinctions for empty/unavailable/locked/stale/error.                                             |
| Data-source authority (audit §4)        | Above-fold metadata includes authority/freshness; attention is explicitly derived; review and lifecycle are kept separate.                                                                |
| Human translation (audit §5)            | Every flow carries a human-readable message template, causal context, actor, time, and next useful action.                                                                                |
| Open decisions and risks (audit §6)     | `OWV-D01`–`OWV-D07` and `OWV-R01`–`OWV-R03` remain unresolved gates; this item makes no silent choices about tokens, fields, mediated reads, lifecycle, or privacy.                       |

## 7. Unresolved questions before prototype work

1. Which token authority resolves `OWV-D01`, and which semantic roles are
   approved for light/dark status states?
2. Which exact project, actor, timestamp, label, evidence pointer, and event
   fields are approved under `OWV-D02` and `OWV-D06`?
3. What mediated read architecture, unlock lifecycle, offline behavior, and
   browser-compromise posture satisfy `OWV-D03`?
4. What retention, compaction, deletion, redaction, and encryption policy
   satisfies `OWV-D04` for timeline and evidence?
5. What freshness thresholds and source-outage copy satisfy `OWV-D05`?
6. Is iteration a relationship, a metadata filter, or both (`OWV-D07`), and
   which no-sprint copy is approved for localization?
7. Which reviewer/verifier roles may see artifact content versus minimized
   metadata, and how are cross-tenant references prevented?
8. What route resolver behavior is approved for a deleted, moved, or stale
   work item deep link?

Prototype and Angular work must answer these questions or record an explicitly
approved follow-up; this IA contract must not be silently broadened.
