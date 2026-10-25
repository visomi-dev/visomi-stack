---
name: kiss
description: "Apply KISS and YAGNI when implementing, reviewing, or refactoring code in visomi-stack. Use to choose a proportional solution, avoid speculative infrastructure, and preserve domain and privacy boundaries. Not a mandate to rewrite existing code or remove capabilities."
---

# Keep changes simple and complete

Read the repository working agreement first. Work only on the requested outcome.

1. Identify the current requirement, existing behavior, and a small verification plan.
2. Look for an existing implementation or approved library before inventing infrastructure.
3. Choose the least complicated design that meets the requirement and its security, privacy, reliability, and accessibility constraints.
4. Keep business capabilities and bounded contexts visible. Do not replace Screaming Architecture with global technical folders.
5. Add abstractions when they clarify ownership, invariants, lifecycle, or an actual boundary. Neither "always use a class" nor "never abstract a single use" is a rule.
6. Prefer a focused diff. Do not rename, reformat, remove features, or clean adjacent code unrelated to the request.
7. Verify the changed behavior with relevant tests and tooling, then report the result and remaining limitations.

## Review questions

- Does each new concept solve a current problem?
- Can a reader identify who creates, uses, and closes each resource?
- Does the proposed simplification preserve behavior and privacy?
- Are we removing accidental complexity or merely moving it to more files?
- Would sharing this code couple domains that should remain independent?

## Boundaries

- Do not add a DI container, generic plugin system, configuration layer, service, dependency, or new infrastructure solely for possible future reuse.
- Do not remove required error handling, validation, authorization, cleanup, or observability privacy controls to reduce line count.
- Do not rewrite working capabilities that the user explicitly wants to keep.
- If a smaller implementation changes behavior, describe that separately and get direction before mixing it into a structural refactor.
- Use repository formatting and naming conventions. Simplicity does not override ESLint, Prettier, or domain semantics.
- For a small change, a short explanation and focused checks are enough. Do not require a PRD, ADR, or multi-document plan unless the decision actually needs one.
