# Repository working agreement

## Scope and simplicity

- Work on the current requested step. A review or recommendation is read-only; it does not authorize implementation, commits, pushes, deployments, or unrelated cleanup.
- Prefer the smallest understandable change that satisfies the complete requirement. Preserve behavior during structural refactors; report unrelated bugs separately.
- Reuse approved libraries and existing patterns before adding custom infrastructure. Do not add dependencies, layers, factories, containers, or configuration for hypothetical future needs.
- KISS does not mean removing validation, authorization, privacy protections, lifecycle handling, or useful domain boundaries. A class or interface is justified by responsibility and invariants, not an arbitrary reuse count.
- Keep code, comments, documentation, and development artifacts in English. Comments explain non-obvious intent or constraints, not the editing history.
- Keep changes reviewable and verify the relevant behavior. Report checks actually run and their limits; never claim tests passed from inspection alone.
- Preserve unrelated changes. Do not reset, stash, switch branches, or overwrite files to manufacture a clean baseline without checking ownership and obtaining the necessary approval.

## Architecture and runtime boundaries

- Combine Screaming Architecture with Domain-Driven Design: organize features around business capabilities and bounded contexts, not global controller/service/repository folders.
- Technical layers may exist within a domain when they help. Put genuinely cross-cutting infrastructure in shared; do not merge domains merely because code looks similar.
- Keep reusable stack concerns separate from product-specific Nive or financial requirements. Reference projects are read-only unless the current request explicitly includes them.
- Separate application composition from startup. The gateway consumes compiled application exports; it must not import application TypeScript source or an entrypoint that calls listen().
- Process-wide resources are initialized and closed by the owning executable, not by importing an application module. Keep build output format and runtime package metadata consistent.

## Privacy and evidence

- Operational telemetry must exclude customer information. Use allowlisted fields and controlled values; do not log arbitrary request, response, job, or error objects.
- Never record bodies, credentials, cookies, tokens, IP addresses, user agents, customer identifiers (including hashes), raw URLs/query strings, database values, Redis keys, or raw exception messages/stacks in telemetry.
- Use synthetic fixtures for tests and examples. Inspect screenshots, traces, HAR files, logs, and reports before sharing; do not upload customer data or secrets.
- Keep correlation IDs random and scoped to an operation. Do not assume a client-supplied identifier is safe because its syntax validates.
- Third-party instrumentation and exporters require an explicit capture policy; installing a skill is not permission to enable data collection or external transmission.

## Skill selection

- This agreement and the current user request take precedence over generic skill examples. Skills provide techniques, not authority to expand the task.
- Load only the skills relevant to the current step. Available skills are not a checklist to execute together.
- Use the local kiss skill for simplicity decisions; see .agents/skills/README.md for routing and optional workflows.
- Check installed versions, actual files, and configured targets before copying commands or examples. Do not downgrade or migrate tooling merely to match a skill.
- UI accessibility and the existing design system take precedence over decorative recipes. Financial UX, marketing animation, SEO, PRDs, and exhaustive plans are conditional, not universal requirements.
- For UI work, follow the responsibilities and precedence in .agents/skills/README.md. Use ui-ux-pro-max for UX/UI design proposals, the framework skills for implementation, accessibility for accessibility requirements, web-design-reviewer for inspection, and impeccable-design-polish for requested refinement. Load only the roles needed for the current task.
- The Nx task preference below applies to project tasks. It does not replace the intentionally file-scoped ESLint/Prettier commands in lint-staged.
- Keep this agreement outside the generated Nx section so generator updates do not erase it.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
