# Local OpenCode Control Plane

This guide explains how to use the local Themis prototype from the
`feature/local-opencode-control-plane` branch. It coordinates work with
OpenCode before the workflow is integrated into the Themis application.

The prototype stores operational state locally:

```text
.themis/state.json       current state, ignored by Git
.themis/events.ndjson    append-only event log, ignored by Git
planning/                human-readable planning artifacts
```

The planning hierarchy is:

```text
Project
└── Epic
    └── Work items

Project
└── Optional sprint or goal window
    └── Sprint memberships for selected work items
```

An epic can span multiple sprints. A work item belongs to one project and may
belong to an epic. Sprint membership is optional planning context. Each project
can have one active sprint, while project-flow execution can continue without a
sprint and different projects can have active sprints at the same time.

Do not edit either runtime file directly. Use the CLI or `themis_*` OpenCode
tools so state transitions and audit events stay consistent.

## 1. Setup

Use Node.js 24 and pnpm. From the repository root:

```bash
pnpm install
pnpm themis --help
```

After changing `opencode.json`, an OpenCode agent, skill, command, or tool,
quit and restart OpenCode. OpenCode loads these files at startup.

## 2. Choose an Interface

Use the CLI for scripts, explicit operations, and JSON output:

```bash
pnpm themis status
pnpm themis status --json
```

Use the TUI for visual inspection:

```bash
pnpm themis tui
```

The TUI displays planning lanes, flow-ready work, blocked work, active runs, and
reviews. Use `h` or Left Arrow for the previous lane, `l` or Right Arrow for
the next lane, `r` to reload state, and `q`, Escape, or Ctrl-C to exit.

Use OpenCode for agent-driven planning and execution:

```text
/themis-workflow <describe the work you want to plan>
```

The default agent is `themis-coordinator`. It delegates to the planner,
executor, verifier, and reviewer agents.

For the first interaction in a workspace, use the onboarding command:

```text
/themis-onboard
```

The coordinator first calls `themis_workspace_status`. A new workspace enters
a context interview before any project or planning entity is created. An
initialized workspace is inspected with repository exploration (or Graphify
when available), then the findings are reported and confirmed with the user
before new epics, work items, or sprints are planned.

Agents that do not have OpenCode's custom tools can load the
`.opencode/skills/themis-onboarding/SKILL.md` skill and use the CLI. This
supports discovery and task management, but the complete delegated execution,
evidence, approval, and review control plane requires OpenCode.

## 3. Organize the Portfolio

Create projects and epics before creating scoped work items:

```bash
pnpm themis project-create \
  --id PRJ-001 \
  --name "Repository platform" \
  --summary "Shared repository infrastructure"

pnpm themis epic-create \
  --id EPIC-001 \
  --project PRJ-001 \
  --title "Repository adapter" \
  --goal "Expose a reliable repository boundary"
```

Inspect the portfolio:

```bash
pnpm themis portfolio --json
pnpm themis project-list --json
pnpm themis epic-list --project PRJ-001 --json
pnpm themis work-list --project PRJ-001 --epic EPIC-001 --json
pnpm themis sprint-list --project PRJ-001 --json
pnpm themis workspace-status --json
pnpm themis timeline --project PRJ-001 --json
```

Close a completed sprint only after its final verification has been recorded:

```bash
pnpm themis sprint-evidence-add \
  --sprint SPR-001 \
  --kind verification \
  --summary "Sprint verification passed" \
  --value "pnpm nx run shared:test: PASS"

pnpm themis sprint-close \
  --project PRJ-001 \
  --sprint SPR-001 \
  --json
```

An empty ready queue does not close a sprint. Closure requires terminal selected
work, no open runs or reviews, and at least one final verification evidence
entry. Closing the active sprint releases the project's single planning slot;
project-flow execution does not wait for that closure.

To intentionally remove all sprint planning state while preserving work items,
runs, execution evidence, and reviews:

```bash
pnpm themis sprint-remove-all --json
```

Pass `--project PRJ-001` to limit the removal to one project. This operation
removes sprints, sprint revisions, memberships, and sprint-level evidence. It
returns `planned` items to `ready` and records an audit event.

The CLI and tools reject work items, epics, and sprints that cross project
boundaries.

## 4. Complete Workflow

The lifecycle is deliberately gated:

```text
work item
  -> ready
  -> project flow queue
  -> claim
  -> run
  -> evidence
  -> review
  -> accepted/done or rejected/rework

optional human planning boundary:
  specification -> sprint proposal -> approval -> activation
  -> outcome inspection -> sprint evidence -> closure
```

### 4.1 Create Work Items

Create a draft item with explicit scope and verification:

```bash
pnpm themis work-create \
  --id THM-001 \
  --title "Create repository adapter" \
  --summary "Add the local repository adapter used by the workflow." \
  --project PRJ-001 \
  --epic EPIC-001 \
  --acceptance "Adapter is callable,Adapter errors are explicit" \
  --scope-in "libs/repository/**,tests/repository/**" \
  --scope-out "apps/web/**,database/**" \
  --verify "pnpm nx test repository,pnpm nx lint repository" \
  --json
```

Move the item to `ready` only after its definition is complete:

```bash
pnpm themis work-transition --id THM-001 --to ready --json
```

Inspect the current state with:

```bash
pnpm themis status
pnpm themis validate
```

### 4.2 Add Dependencies

The first argument blocks the second:

```bash
pnpm themis dependency-add --from THM-001 --to THM-002 --json
```

Blocked items never appear in the ready queue until their blocking items are
`done`.

### 4.3 Propose a Sprint

All selected items must already be `ready`:

```bash
pnpm themis sprint-propose \
  --goal "Validate the repository integration" \
  --why "The adapter is required before downstream work can start" \
  --what "A tested repository integration" \
  --how "Implement the adapter, verify it, and review the evidence" \
  --project PRJ-001 \
  --epics EPIC-001 \
  --work-items "THM-001,THM-002" \
  --non-goals "SQLite migration,Themis dashboard" \
  --done "Acceptance criteria pass,Verification evidence exists,Review is accepted" \
  --verify "pnpm nx test repository,pnpm nx lint repository" \
  --json
```

Save the returned `sprintId` and revision `id`. A later proposal for the same
sprint should pass `--sprint <sprint-id>` to create a new revision instead of
overwriting the previous one.

### 4.4 Approve and Activate (Optional Planning Boundary)

Approval is a human gate. Inspect the proposal before running these commands:

```bash
pnpm themis sprint-approve \
  --sprint SPR-001 \
  --revision REV-001 \
  --json

pnpm themis sprint-activate \
  --sprint SPR-001 \
  --revision REV-001 \
  --json
```

Activation assigns the selected work items to the planning boundary and
calculates an optional forecast baseline. It does not claim work and is not
required before project-flow execution.

### 4.5 Inspect Ready Work

```bash
pnpm themis ready --project PRJ-001 --sprint SPR-001
pnpm themis ready --project PRJ-001 --sprint SPR-001 --json
```

With a sprint filter, only planned items in that sprint with completed blocking
dependencies are returned. Without a sprint filter, the project flow returns
`ready` and `planned` items with completed dependencies:

```bash
pnpm themis ready --project PRJ-001
pnpm themis ready --project PRJ-001 --wip 3
```

### 4.6 Claim and Start a Run

```bash
pnpm themis claim \
  --id THM-001 \
  --agent themis-executor \
  --json

pnpm themis run-start \
  --work-item THM-001 \
  --agent themis-executor \
  --json
```

The run identifier returned by `run-start` is required for evidence and run
completion. An active sprint is not required.

### 4.7 Record Evidence

At minimum, record an implementation diff and verification result:

```bash
pnpm themis evidence-add \
  --run RUN-001 \
  --kind implementation-diff \
  --summary "Implementation commit" \
  --value "commit abc1234" \
  --json

pnpm themis evidence-add \
  --run RUN-001 \
  --kind verification \
  --summary "Repository tests passed" \
  --value "pnpm nx test repository: PASS" \
  --json
```

Do not record a command as passed without its observed output. Do not place
secrets in evidence values.

### 4.8 Finish and Request Review

```bash
pnpm themis run-finish \
  --run RUN-001 \
  --status completed \
  --reason "Required verification passed" \
  --json

pnpm themis review-request \
  --work-item THM-001 \
  --reviewer themis-reviewer \
  --json
```

Review cannot be requested until the run is completed and both required
evidence kinds exist.

### 4.9 Accept or Reject

Use an independent reviewer:

```bash
pnpm themis review-submit \
  --review REVW-001 \
  --verdict accepted \
  --feedback "Acceptance criteria and verification evidence are complete" \
  --json
```

An accepted review moves the work item to `done`. A rejected review moves it
to `rework` and preserves the feedback.

## 5. OpenCode Roles

| Role                 | Responsibility                                  | Code editing  |
| -------------------- | ----------------------------------------------- | ------------- |
| `themis-coordinator` | Coordinates the workflow and gates              | No            |
| `themis-planner`     | Creates work items, dependencies, and proposals | Planning only |
| `themis-executor`    | Implements one claimed item                     | Yes, scoped   |
| `themis-verifier`    | Runs required checks and records evidence       | No            |
| `themis-reviewer`    | Independently accepts or rejects work           | No            |

The agents use these skills:

```text
themis-work-item
themis-sprint-planning
themis-sprint-activation
themis-execution
themis-evidence
themis-review
```

Command execution permissions are inherited from the active OpenCode
workspace. The role definitions only constrain editing where required:
executors may edit scoped implementation files, while coordinators, verifiers,
and reviewers cannot edit implementation files. Configure the workspace's
`bash` permission once instead of adding per-agent `bash: ask` overrides; this
allows verification agents to run tests, builds, lint, and E2E checks without a
prompt for every command.

The underlying tools are available to OpenCode as names such as
`themis_workitem_create`, `themis_sprint_activate`,
`themis_flow_ready_queue`, `themis_ready_queue`, `themis_run_start`,
`themis_evidence_add`, and `themis_review_submit`.

## 6. Inspect History

Print the latest events:

```bash
pnpm themis events --limit 30
pnpm themis events --limit 30 --json
```

The event log is append-only and contains the actor, event type, aggregate,
timestamp, and payload. The normalized current state remains in
`.themis/state.json`.

## 7. Reset Local Runtime State

Only reset local state when you intentionally want to discard the prototype's
current workflow:

```bash
rm -f .themis/state.json .themis/events.ndjson
pnpm themis validate
```

This does not remove versioned planning artifacts or the fixture.

## 8. Verification

Run the complete local prototype suite:

```bash
pnpm themis:test
```

The suite covers the domain state machine, public OpenCode tools, CLI lifecycle,
and TUI rendering. For the repository's full validation, use the normal Nx
targets and the pre-push hook.

## 9. Troubleshooting

### OpenCode does not show the new agents or tools

Quit and restart OpenCode. Configuration and extension files are loaded only at
startup.

### `ready` reports no work

For sprint-scoped work, check that the sprint is active, selected work items are
`planned`, and all blocking dependencies are `done`:

```bash
pnpm themis status --sprint SPR-001
pnpm themis validate
pnpm themis events --limit 50
```

For continuous project flow, inspect the project queue instead:

```bash
pnpm themis ready --project PRJ-001
```

### A transition is rejected

The rejection is intentional. Read the missing precondition in the error and
inspect the work item, run, evidence, or review before retrying. Never bypass
the error by editing runtime JSON.

### The TUI is unreadable or does not start

Run it in a real terminal with the project root as the current directory:

```bash
pnpm themis tui
```

For automation and CI, use `status --json`, `ready --json`, and `events --json`
instead of the interactive TUI.
