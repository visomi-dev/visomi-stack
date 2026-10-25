---
name: acquire-codebase-knowledge
description: 'Use this skill when the user explicitly asks to map, document, or onboard into an existing codebase. Trigger for prompts like "map this codebase", "document this architecture", "onboard me to this repo", or "create codebase docs". Do not trigger for routine feature implementation, bug fixes, or narrow code edits unless the user asks for repository-level discovery.'
license: MIT
compatibility: 'Cross-platform. Optional scan helper requires Python 3.8+ and git; manual read-only inspection is also supported.'
metadata:
  version: '1.3'
  enhancements:
    - Multi-language manifest detection (25+ languages supported)
    - CI/CD pipeline detection (10+ platforms)
    - Container & orchestration detection
    - Code metrics by language
    - Security & compliance config detection
    - Performance testing markers
argument-hint: 'Optional: specific area to focus on, e.g. "architecture only", "testing and concerns"'
---

# Acquire Codebase Knowledge

Maps an existing codebase at the depth explicitly requested. A focused question may need only a concise response or one document; a full documentation request may use the seven templates in `docs/codebase/`. Only document what is verifiable from files or terminal output — never infer or assume. Follow applicable repository instructions, privacy rules, and user review checkpoints. Discovery does not authorize implementation or publication.

## Output Contract (Required)

Before finishing, all of the following must be true:

1. Deliver only the requested scope and format. Create files only when requested, using an established or agreed destination. For a full seven-area documentation request, the optional templates are `STACK.md`, `STRUCTURE.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `INTEGRATIONS.md`, `TESTING.md`, and `CONCERNS.md`.
2. Every claim is traceable to source files, config, or terminal output.
3. Unknowns are marked as `[TODO]`; intent-dependent decisions are marked `[ASK USER]`.
4. Every document includes a short "evidence" list with concrete file paths.
5. Final response includes numbered `[ASK USER]` questions and intent-vs-reality divergences.

## Workflow

Copy and track this checklist:

```
- [ ] Phase 1: Inspect relevant structure and available intent documents
- [ ] Phase 2: Investigate the requested documentation areas
- [ ] Phase 3: Draft only the requested deliverables
- [ ] Phase 4: Validate claims, present findings, identify unresolved decisions
```

## Focus Area Mode

If the user supplies a focus area (for example: "architecture only" or "testing and concerns"):

1. Inspect only the structure and evidence needed for the requested focus.
2. Complete only requested areas; do not create placeholders for unrelated documents.
3. Mark unknowns within scope as `[TODO]` and decisions requiring intent as `[ASK USER]`.
4. Validate only the requested deliverables. Expand scope only with user agreement.

### Phase 1: Scan and Read Intent

1. Prefer existing repository navigation tools and read-only inspection. If a broad inventory is explicitly requested and the optional scan is useful, inspect the script first and run it only within the authorized environment and write scope:

   ```bash
   python3 "$SKILL_ROOT/scripts/scan.py" --output docs/codebase/.codebase-scan.txt
   ```

   Where `$SKILL_ROOT` is the absolute path to the skill folder. Works on Windows, macOS, and Linux.

   **Quick start:** If you have the path inline:

   ```bash
   python3 /absolute/path/to/skills/acquire-codebase-knowledge/scripts/scan.py --output docs/codebase/.codebase-scan.txt
   ```

2. Find and read relevant existing intent documents, such as `PRD`, `TRD`, `README`, `ROADMAP`, `SPEC`, or `DESIGN`; do not require these filenames.
3. Summarise the stated project intent before reading any source code.

### Phase 2: Investigate

Use observed repository evidence to answer questions for the selected areas. Load only relevant portions of [`references/inquiry-checkpoints.md`](references/inquiry-checkpoints.md).

If the stack is ambiguous (multiple manifest files, unfamiliar file types, no `package.json`), load [`references/stack-detection.md`](references/stack-detection.md).

### Phase 3: Populate Templates

For an explicitly requested full documentation set, these templates are available. For focused work, use only relevant sections and the agreed output destination:

1. [STACK.md](assets/templates/STACK.md) — language, runtime, frameworks, all dependencies
2. [STRUCTURE.md](assets/templates/STRUCTURE.md) — directory layout, entry points, key files
3. [ARCHITECTURE.md](assets/templates/ARCHITECTURE.md) — layers, patterns, data flow
4. [CONVENTIONS.md](assets/templates/CONVENTIONS.md) — naming, formatting, error handling, imports
5. [INTEGRATIONS.md](assets/templates/INTEGRATIONS.md) — external APIs, databases, auth, monitoring
6. [TESTING.md](assets/templates/TESTING.md) — frameworks, file organization, mocking strategy
7. [CONCERNS.md](assets/templates/CONCERNS.md) — tech debt, bugs, security risks, perf bottlenecks

Use `[TODO]` for anything that cannot be determined from code. Use `[ASK USER]` where the right answer requires team intent.

### Phase 4: Validate, Repair, Verify

Run this mandatory validation loop before finalizing:

1. Validate each requested deliverable against the relevant inquiry checkpoints.
2. For each non-trivial claim, confirm at least one evidence reference exists.
3. If any required section is missing or unsupported:

- Fix the document.
- Re-run validation.

4. Repair unsupported claims within scope; do not manufacture evidence or expand to unrelated documents.

Then summarize the requested deliverables, list material `[ASK USER]` items, and highlight evidenced Intent vs. Reality divergences. Unresolved questions remain explicit; do not invent an answer to mark the work complete.

Validation pass criteria:

- No unsupported claims.
- No empty required sections.
- Unknowns use `[TODO]` rather than assumptions.
- Team-intent gaps are explicitly marked `[ASK USER]`.

---

## Gotchas

**Monorepos:** Root `package.json` may have no source — check for `workspaces`, `packages/`, or `apps/` directories. Each workspace may have independent dependencies and conventions. Map each sub-package separately.

**Outdated README:** README often describes intended architecture, not the current one. Cross-reference with actual file structure before treating any README claim as fact.

**TypeScript path aliases:** `tsconfig.json` `paths` config means imports like `@/foo` don't map directly to the filesystem. Map aliases to real paths before documenting structure.

**Generated/compiled output:** Never document patterns from `dist/`, `build/`, `generated/`, `.next/`, `out/`, or `__pycache__/`. These are artefacts — document source conventions only.

**`.env.example` reveals required config:** Secrets are never committed. Read `.env.example`, `.env.template`, or `.env.sample` to discover required environment variables.

**`devDependencies` ≠ production stack:** Only `dependencies` (or equivalent, e.g. `[tool.poetry.dependencies]`) runs in production. Document linters, formatters, and test frameworks separately as dev tooling.

**Test TODOs ≠ production debt:** TODOs inside `test/`, `tests/`, `__tests__/`, or `spec/` are coverage gaps, not production technical debt. Separate them in `CONCERNS.md`.

**High-churn files = fragile areas:** Files appearing most in recent git history have the highest modification rate and likely hidden complexity. Always note them in `CONCERNS.md`.

---

## Anti-Patterns

| ❌ Don't                                                                            | ✅ Do instead                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| "Uses Clean Architecture with Domain/Data layers." (when no such directories exist) | State only what directory structure actually shows.           |
| "This is a Next.js project." (without checking `package.json`)                      | Check `dependencies` first. State what's actually there.      |
| Guess the database from a variable name like `dbUrl`                                | Check manifest for `pg`, `mysql2`, `mongoose`, `prisma`, etc. |
| Document `dist/` or `build/` naming patterns as conventions                         | Source files only.                                            |

---

## Enhanced Scan Output Sections

The `scan.py` script now produce the following sections in addition to the original output:

- **CODE METRICS** — Total files, lines of code by language, largest files (complexity signals)
- **CI/CD PIPELINES** — Detected GitHub Actions, GitLab CI, Jenkins, CircleCI, etc.
- **CONTAINERS & ORCHESTRATION** — Docker, Docker Compose, Kubernetes, Vagrant configs
- **SECURITY & COMPLIANCE** — Snyk, Dependabot, SECURITY.md, SBOM, security policies
- **PERFORMANCE & TESTING** — Benchmark configs, profiling markers, load testing tools

Use these sections during Phase 2 to inform investigation questions and identify tool-specific patterns.

---

## Bundled Assets

| Asset                                | When to load                                                        |
| ------------------------------------ | ------------------------------------------------------------------- |
| [`scripts/scan.py`](scripts/scan.py) | Optional broad inventory after inspecting the script and confirming execution/write scope |

| [`references/inquiry-checkpoints.md`](references/inquiry-checkpoints.md) | Phase 2 — load for per-template investigation questions |
| [`references/stack-detection.md`](references/stack-detection.md) | Phase 2 — only if stack is ambiguous |
| [`assets/templates/STACK.md`](assets/templates/STACK.md) | Phase 3 step 1 |
| [`assets/templates/STRUCTURE.md`](assets/templates/STRUCTURE.md) | Phase 3 step 2 |
| [`assets/templates/ARCHITECTURE.md`](assets/templates/ARCHITECTURE.md) | Phase 3 step 3 |
| [`assets/templates/CONVENTIONS.md`](assets/templates/CONVENTIONS.md) | Phase 3 step 4 |
| [`assets/templates/INTEGRATIONS.md`](assets/templates/INTEGRATIONS.md) | Phase 3 step 5 |
| [`assets/templates/TESTING.md`](assets/templates/TESTING.md) | Phase 3 step 6 |
| [`assets/templates/CONCERNS.md`](assets/templates/CONCERNS.md) | Phase 3 step 7 |

Template usage mode:

- Default mode: complete only relevant core sections in the requested templates.
- Extended mode: add optional sections only when the repo complexity justifies them.
