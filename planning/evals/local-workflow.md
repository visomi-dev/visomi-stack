# Local Workflow Evaluation

The prototype is valid only when the following cases pass:

- A work item without acceptance criteria cannot become `ready`.
- A work item with an incomplete blocking dependency is absent from `ready_queue`.
- An unapproved sprint cannot be activated.
- A work item without a completed run cannot request review.
- A work item without implementation-diff and verification evidence cannot request review.
- An accepted review moves work to `done`.
- A rejected review moves work to `rework` with actionable feedback.
- Repeating a completed review does not change its verdict.
- `validate` reports no dangling references.

Run the automated suite with:

```text
node --experimental-strip-types --test scripts/themis-core.test.ts
```

Validate the public OpenCode tool protocol with:

```text
node --experimental-strip-types --test scripts/themis-tools.e2e.test.ts
```
