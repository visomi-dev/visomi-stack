# Skill routing for visomi-stack

Skills are available references, not a workflow to run in full. Follow the repository working agreement in AGENTS.md (or its CLAUDE.md mirror) and the current request. Read only the material needed for the task.

## Default approach

Use kiss to keep implementation proportional without weakening domain boundaries, privacy, security, accessibility, or existing capabilities. Prefer a focused change and relevant checks over an automatic PRD, architecture rewrite, or new dependency.

For backend implementation, nodejs-express-server is the primary guide. The other Node skills are supplemental references for a specific question, not competing architecture defaults. Existing repository decisions and installed versions override generic examples.

For UI work, preserve the approved design system. Use web-design-reviewer for inspection, accessibility for accessibility requirements, and impeccable-design-polish for requested refinement. Marketing aesthetics and financial-product rules require the corresponding product scope.

## Routing inventory

| Skills | Use when |
| --- | --- |
| kiss | Choosing a simple, complete implementation or reviewing unnecessary complexity. |
| nx-workspace, nx-run-tasks, nx-generate, nx-plugins | Inspecting resolved projects/targets, running tasks, generating artifacts, or adding approved Nx integrations. |
| link-workspace-packages | Fixing actual package links in the repository's chosen workspace model. |
| nx-import | An explicitly requested repository/history import; never a default way to copy reference code. Verify version-specific advice. |
| nodejs-express-server | Implementing this Express backend with domain-first organization and safe telemetry. |
| nodejs-backend-patterns, nodejs-best-practices | A focused backend pattern or runtime question not already covered by the canonical guide. |
| angular-developer | Angular work matched to the installed version and existing Nx targets. |
| astro | Work in an actual Astro project, not every static-rendering task. |
| typescript-advanced-types | A real type-modeling problem; not a requirement to make ordinary types advanced. |
| zod | A project already using or explicitly adopting Zod; availability is not an installation decision. |
| vite, vitest | Their actual configuration and tests; preserve Nx integration and verify version-sensitive examples. |
| playwright-best-practices | Browser/API test work using existing fixtures and runners. Avoid imposing every optional pattern. |
| accessibility | Accessibility design, implementation, and verification; required protections are not optional polish. |
| tailwind-css-patterns | Tailwind work matched to the installed major version and existing design tokens. |
| web-design-reviewer | Canonical visual/UX inspection; findings do not authorize edits. |
| impeccable-design-polish | Explicitly requested refinement of an existing design. |
| ui-screenshots | Safe visual evidence using synthetic data and the existing browser-testing tools. |
| frontend-design, premium-frontend-ui | Explicit creative/marketing exploration, not default application styling or mandatory animation. |
| financial-product-ux | Financial product flows; do not add Nive-specific concepts to the reusable stack by default. |
| seo | Public, indexable pages only; not authenticated application surfaces. |
| context-map, feature-slicing | A concise map and incremental slices when a change benefits from them. |
| acquire-codebase-knowledge | Explicit onboarding or a scoped codebase investigation; do not regenerate a full document set routinely. |
| feature-spec, prd, create-implementation-plan | Explicitly requested specification or planning artifacts, proportional to the task and reviewed by the user. |
| create-architectural-decision-record | A durable architectural choice with meaningful alternatives, not every implementation detail. |
| create-readme | Requested README creation or revision based on verified repository behavior. |
| agent-handoff | A real handoff or unfinished task; distinguish completed, proposed, and unverified work. |
| commit-message-storyteller | Preferred commit-message drafting workflow; explain why without inventing motivation. |
| conventional-commit | Conventional Commit format reference; not permission to stage or commit. |
| conventional-branch | Branch naming, or creation only when explicitly requested and safe for the current worktree. |
| changelog | Requested changelog maintenance; inspect generated entries, including same-day commits, before accepting the output. |
| copilot-instructions-blueprint-generator | Explicit maintenance of Copilot-specific instructions when that integration is used. |
| codeql | Requested static security analysis; installations, workflow edits, permissions, uploads, and publishing require appropriate authorization. |
| nx-cloud-api, nx-cloud-cache-investigator, nx-cloud-ci-failure-review | Relevant Nx Cloud data investigations only when that service is actually configured and accessible. |
| monitor-ci | Requested CI observation; fixes and remote mutations are separate, explicitly authorized actions. |

## Guardrails for examples and maintenance

- Read package manifests, lockfiles, and current configuration before copying recipes. Do not impose old ESLint, Vitest, Tailwind, Node, or Angular versions.
- Generic diagrams, templates, and sample directory layouts are illustrative. Never create missing product files just to satisfy a borrowed template.
- Do not install a third-party skill bundle merely because it contains one useful rule. Review its actual instructions, provenance, scripts, and update behavior first.
- Do not silently expand read-only review into editing, committing, pushing, publishing, or deployment.
- Audit scope is not full certification: references and scripts may contain assumptions beyond their SKILL.md. Verify any example before using it.
- Keep the generated Nx guidance intact and maintain local working agreements outside its markers.
