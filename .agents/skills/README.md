# Skill routing for visomi-stack

Skills are available references, not a workflow to run in full. Follow the repository working agreement in AGENTS.md (or its CLAUDE.md mirror) and the current request. Read only the material needed for the task.

## Default approach

Use kiss to keep implementation proportional without weakening domain boundaries, privacy, security, accessibility, or existing capabilities. Prefer a focused change and relevant checks over an automatic PRD, architecture rewrite, or new dependency.

For backend implementation, nodejs-express-server is the primary guide. The other Node skills are supplemental references for a specific question, not competing architecture defaults. Existing repository decisions and installed versions override generic examples.

For UI work, ui-ux-pro-max is the primary source of UX/UI design proposals. Preserve the approved design system and use the responsibilities below to select only the guidance needed for the current task.

## UI responsibilities and precedence

| Skill                                | Responsibility                                                                                                             | Boundary                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ui-ux-pro-max                        | Propose visual foundations, information hierarchy, navigation, forms, feedback, responsive layouts, and data presentation. | Search results are recommendations. Reuse approved tokens and components; do not regenerate the design system for each new page.  |
| angular-developer                    | Own Angular implementation choices, component APIs, forms, routing, SSR, and hydration.                                    | Installed versions, repository patterns, and Nx configuration govern implementation; generic stack examples are supplemental.     |
| astro                                | Own implementation in confirmed Astro projects.                                                                            | Do not select a framework or scaffold a new project because the design skill includes an example.                                 |
| accessibility                        | Guide accessibility requirements and their verification.                                                                   | Visual preferences and generated checklists cannot weaken accessibility. An automated audit alone does not establish conformance. |
| tailwind-css-patterns                | Express the agreed design using the installed Tailwind version and existing tokens.                                        | Do not introduce Tailwind, a new palette, or another component system implicitly.                                                 |
| web-design-reviewer                  | Lead visual/UX inspection of rendered screens and prioritize findings.                                                     | Reviews are read-only unless fixes are requested; use ui-ux-pro-max only for a specific supporting question.                      |
| impeccable-design-polish             | Refine existing screens when requested, preserving identity, behavior, and content.                                        | Do not restart design direction or automatically add animation, dependencies, or another skill bundle.                            |
| ui-screenshots                       | Capture and inspect visual evidence with existing tooling and synthetic data.                                              | Evidence supports review; it does not replace interaction testing or authorize baseline updates.                                  |
| frontend-design, premium-frontend-ui | Explore a creative direction for an explicitly requested redesign or marketing surface.                                    | Do not apply their aesthetic prescriptions to routine product UI; coordinate with ui-ux-pro-max around one chosen direction.      |
| financial-product-ux, seo            | Add domain-specific financial guidance or public-page search requirements when applicable.                                 | Keep product rules separate from the reusable stack; SEO does not apply to authenticated application surfaces.                    |

Resolve overlapping advice in this order:

1. Follow the current user request and repository working agreement, including privacy, security, and accessibility constraints.
2. Preserve the approved product brief, design tokens, components, and interaction patterns unless their change is in scope. Report any conflict with required protections and address it within the authorized work.
3. Use the skill responsible for the concern: framework skills govern implementation, accessibility governs its requirements, and ui-ux-pro-max proposes UX/UI decisions within those constraints.
4. Treat other skill examples and search output as optional supporting material. Do not combine competing palettes, typography systems, or animation prescriptions.

For a new visual direction, use ui-ux-pro-max to propose a coherent system. For a new page in an established product, reuse that system and search only for the missing pattern. For a layout review, use web-design-reviewer; for requested refinement, use impeccable-design-polish. These are task-specific choices, not mandatory sequential phases. Keep loading proportional to the request, and preserve review-only scope.

UI UX Pro Max is installed only in `.agents/skills/ui-ux-pro-max` from [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/28b3b8dee8c976df4fa3e94aed4e092ad43fcb03/.claude/skills/ui-ux-pro-max), revision `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`. Its entrypoint is adapted for repository routing and local script paths; its data and Python helpers are vendored. Updates are deliberate: review upstream changes and preserve local boundaries rather than replacing the folder automatically. The upstream MIT license is included in the skill folder.

## Routing inventory

| Skills                                                                | Use when                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| kiss                                                                  | Choosing a simple, complete implementation or reviewing unnecessary complexity.                                                            |
| nx-workspace, nx-run-tasks, nx-generate, nx-plugins                   | Inspecting resolved projects/targets, running tasks, generating artifacts, or adding approved Nx integrations.                             |
| link-workspace-packages                                               | Fixing actual package links in the repository's chosen workspace model.                                                                    |
| nx-import                                                             | An explicitly requested repository/history import; never a default way to copy reference code. Verify version-specific advice.             |
| nodejs-express-server                                                 | Implementing this Express backend with domain-first organization and safe telemetry.                                                       |
| nodejs-backend-patterns, nodejs-best-practices                        | A focused backend pattern or runtime question not already covered by the canonical guide.                                                  |
| angular-developer                                                     | Angular work matched to the installed version and existing Nx targets.                                                                     |
| astro                                                                 | Work in an actual Astro project, not every static-rendering task.                                                                          |
| typescript-advanced-types                                             | A real type-modeling problem; not a requirement to make ordinary types advanced.                                                           |
| zod                                                                   | A project already using or explicitly adopting Zod; availability is not an installation decision.                                          |
| vite, vitest                                                          | Their actual configuration and tests; preserve Nx integration and verify version-sensitive examples.                                       |
| playwright-best-practices                                             | Browser/API test work using existing fixtures and runners. Avoid imposing every optional pattern.                                          |
| ui-ux-pro-max                                                         | Primary UX/UI design proposals and targeted pattern searches, constrained by the approved design system and the responsibilities above.    |
| accessibility                                                         | Accessibility design, implementation, and verification; required protections are not optional polish.                                      |
| tailwind-css-patterns                                                 | Tailwind work matched to the installed major version and existing design tokens.                                                           |
| web-design-reviewer                                                   | Canonical visual/UX inspection; findings do not authorize edits.                                                                           |
| impeccable-design-polish                                              | Explicitly requested refinement of an existing design.                                                                                     |
| ui-screenshots                                                        | Safe visual evidence using synthetic data and the existing browser-testing tools.                                                          |
| frontend-design, premium-frontend-ui                                  | Explicit creative/marketing exploration, not default application styling or mandatory animation.                                           |
| financial-product-ux                                                  | Financial product flows; do not add Nive-specific concepts to the reusable stack by default.                                               |
| seo                                                                   | Public, indexable pages only; not authenticated application surfaces.                                                                      |
| context-map, feature-slicing                                          | A concise map and incremental slices when a change benefits from them.                                                                     |
| acquire-codebase-knowledge                                            | Explicit onboarding or a scoped codebase investigation; do not regenerate a full document set routinely.                                   |
| feature-spec, prd, create-implementation-plan                         | Explicitly requested specification or planning artifacts, proportional to the task and reviewed by the user.                               |
| create-architectural-decision-record                                  | A durable architectural choice with meaningful alternatives, not every implementation detail.                                              |
| create-readme                                                         | Requested README creation or revision based on verified repository behavior.                                                               |
| agent-handoff                                                         | A real handoff or unfinished task; distinguish completed, proposed, and unverified work.                                                   |
| commit-message-storyteller                                            | Preferred commit-message drafting workflow; explain why without inventing motivation.                                                      |
| conventional-commit                                                   | Conventional Commit format reference; not permission to stage or commit.                                                                   |
| conventional-branch                                                   | Branch naming, or creation only when explicitly requested and safe for the current worktree.                                               |
| changelog                                                             | Requested changelog maintenance; inspect generated entries, including same-day commits, before accepting the output.                       |
| copilot-instructions-blueprint-generator                              | Explicit maintenance of Copilot-specific instructions when that integration is used.                                                       |
| codeql                                                                | Requested static security analysis; installations, workflow edits, permissions, uploads, and publishing require appropriate authorization. |
| nx-cloud-api, nx-cloud-cache-investigator, nx-cloud-ci-failure-review | Relevant Nx Cloud data investigations only when that service is actually configured and accessible.                                        |
| monitor-ci                                                            | Requested CI observation; fixes and remote mutations are separate, explicitly authorized actions.                                          |

## Guardrails for examples and maintenance

- Read package manifests, lockfiles, and current configuration before copying recipes. Do not impose old ESLint, Vitest, Tailwind, Node, or Angular versions.
- Generic diagrams, templates, and sample directory layouts are illustrative. Never create missing product files just to satisfy a borrowed template.
- Do not install a third-party skill bundle merely because it contains one useful rule. Review its actual instructions, provenance, scripts, and update behavior first.
- Do not silently expand read-only review into editing, committing, pushing, publishing, or deployment.
- Audit scope is not full certification: references and scripts may contain assumptions beyond their SKILL.md. Verify any example before using it.
- Keep the generated Nx guidance intact and maintain local working agreements outside its markers.
