---
name: context-map
description: 'Map relevant files, dependencies, and tests when a requested change spans multiple areas or the user asks for an impact map. Keep small changes to a few evidence-backed bullets.'
---

# Context Map

Before a cross-cutting or unfamiliar change, inspect the relevant code and summarize its impact. For a small, clear edit, a few bullets are enough; do not impose a formal map or extra document. Follow applicable repository instructions, domain-first boundaries, privacy rules, and the user's approval checkpoints.

## Task

{{task_description}}

## Instructions

1. Start with `codegraph_explore` using the relevant symbols or paths. Use the returned source and relationships to identify affected files, direct dependencies, related tests, and similar patterns.
2. Follow the code and documentation lookup rules in `AGENTS.md` for gaps in the index and use `find-docs` when the map depends on a third-party API or tool.

## Optional Output Format

Use only sections relevant to the task. Cite existing paths; do not invent missing files to fill a table. A context map is a concise planning aid, not a requirement to create a PRD, spec directory, or implementation plan.

```markdown
## Context Map

### Files to Modify

| File         | Purpose     | Changes Needed |
| ------------ | ----------- | -------------- |
| path/to/file | description | what changes   |

### Dependencies (may need updates)

| File        | Relationship                 |
| ----------- | ---------------------------- |
| path/to/dep | imports X from modified file |

### Test Files

| Test         | Coverage                     |
| ------------ | ---------------------------- |
| path/to/test | tests affected functionality |

### Reference Patterns

| File            | Pattern           |
| --------------- | ----------------- |
| path/to/similar | example to follow |

### Risk Assessment

- [ ] Breaking changes to public API
- [ ] Database migrations needed
- [ ] Configuration changes required
```

Present the map before implementing when the user requested review or a material decision remains unresolved. Respect explicit approval gates; do not turn trivial edits into an unrequested documentation workflow.
