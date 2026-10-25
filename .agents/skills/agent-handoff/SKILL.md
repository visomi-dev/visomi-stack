---
name: agent-handoff
description: Produce concise handoff notes for another agent or developer, including changed files, verification, risks, and next PR slice.
compatibility: opencode
metadata:
  audience: agents
  workflow: collaboration
---

# Agent Handoff Skill

Use this skill before ending an incomplete implementation, after a large investigation, or when another agent will continue the work.

## Workflow

1. Inspect the current worktree status and relevant diffs.
2. Summarize only the work that was actually completed.
3. Separate completed changes from remaining tasks.
4. Include verification commands that were run and their results.
5. Include commands that still need to be run if verification was skipped.
6. Identify risks, blockers, and the recommended next PR slice.

## Output Format

Use this structure:

```md
## Handoff

Changed:

- ...

Files touched:

- `path/to/file`

Verification:

- `command`: passed/failed/skipped with reason

Remaining:

- ...

Risks:

- ...

Next slice:

- ...
```

Keep the handoff factual and concise. Do not invent completed work or verification.
