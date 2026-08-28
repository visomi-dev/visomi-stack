# UI Designer App — Requirements

## Context

The Themis web app and the Astro site both consume the same Themis Catalyst Tailwind v4 tokens defined in `styles.base.css`. The Angular app uses the `shared/ui` primitive library in `apps/web/app/src/app/shared/ui` to render screens from those tokens.

Before any visual change lands, designers and engineers want to validate a screen against the actual token file in a running browser. Today there is no first-party tool for that. Instead, the workspace carries:

1. A vendored copy of Open Design prototypes at `resources/open-design/themis-app/` (HTML files, `critique.json`, `.open-design/project.json`, `.od-skills/`). These prototypes use a third palette (`--tm-*`) that was realigned to Catalyst in [`2026-06-23-catalyst-pure-tokens-alignment/`](../2026-06-23-catalyst-pure-tokens-alignment/). They are no longer the visual source of truth.
2. The `themis-design-system` opencode skill under `.opencode/skills/themis-design-system/`. It points at the same vendored prototypes and the legacy `colors_and_type.css`. It cannot be used to author a screen that matches the real app.
3. The historical specs `2026-06-22-themis-web-app-redesign/` and `2026-06-23-themis-auth-fidelity-pass/` reference the vendored prototypes as their visual source. Both are completed work; the references are stale.

This spec removes the dead weight and replaces it with a first-party preview application that reuses the actual token file, plus a new opencode skill that drives the workflow.

## Goals

1. Delete `resources/open-design/themis-app/` and `.opencode/skills/themis-design-system/` and the two historical specs (`2026-06-22-themis-web-app-redesign/`, `2026-06-23-themis-auth-fidelity-pass/`) that reference them. The deleted files have already served their purpose and the references are stale.
2. Update `docs/constitution/roadmap.md` to drop the Auth Flow Fidelity Pass phase and add a UI Designer App phase pointing at this spec.
3. Install two upstream open-design skills (`impeccable-design-polish`, `login-flow`) to fill the gaps left by the deleted `themis-design-system` skill. The Themis brand contracts already live in `docs/design-system/tokens.md` and `DESIGN.md`; an Anthropic-derived brand skill would add noise without value.
4. Scaffold `apps/web/ui-designer` as a Node + Express + Tailwind v4 + esbuild preview app:
   - Reuses `styles.base.css` from the workspace root.
   - Exposes `GET /`, `GET /preview/:slug`, `GET /api/prototypes`, `GET /healthz`, `GET /events` (SSE).
   - Has a preview chrome with dark toggle and viewport switcher (mobile 375, tablet 768, desktop 1280).
   - Ships one seed prototype (`app-auth-shell`) that mirrors the auth shell recipe in `docs/design-system/recipes.md`.
   - Runs as `pnpm nx serve ui-designer` on port 4300 (env-overridable).
5. Create a new `themis-ui-prototype` opencode skill that drives the workflow: read tokens, create prototype, preview, screenshot, review.
6. Keep the runtime uniform across the workspace. The preview app runs on Node (same as `apps/web/server`, `apps/web/api`, `apps/worker`, `apps/web/realtime`). Bun is out of scope.

## Non-Goals

1. Bun runtime support. The user explicitly chose "Solo Node" to keep the workspace runtime uniform.
2. Migrating the Astro site to consume the preview app's CSS. The site can link to a preview URL in design docs, but the integration is a follow-up.
3. A full visual regression harness. The `web-design-reviewer` and `ui-screenshots` skills cover the manual loop; Playwright snapshot tests for the seed prototype land in a follow-up spec.
4. New Angular primitives. The seed prototype is hand-composed Tailwind, not an Angular component. The Angular app already consumes the `shared/ui` primitives.
5. Re-authoring the deleted specs' design notes. The auth shell recipe in `docs/design-system/recipes.md` already captures the relevant contract; the new seed prototype is the visual reference going forward.
6. A plugin system for prototypes outside `src/prototypes/`. PR3 ships a single seeded location. Plugin support is a follow-up.

## Decisions

### D1 — Runtime: Node only

The `apps/web/server` and `apps/web/api` apps use `@nx/js:node` and `@nx/esbuild:esbuild`. Nx does not ship a native Bun executor. Keeping the ui-designer on Node avoids introducing a parallel deployment story for a tooling app that has no Bun-specific dependencies. A future spec can add a Bun target if the user revisits this decision.

### D2 — Reuse `styles.base.css` directly

The token file lives at the workspace root and is consumed by both the Angular app (`apps/web/app/src/styles.css` imports it) and the Astro site (the same Tailwind v4 + `@theme` block). The preview app copies it into `dist/.../public/` at build time and pipes it through `@tailwindcss/postcss` so prototypes pick up the same variables without any fork.

### D3 — Express 5

Matches `apps/web/api` and `apps/web/server`. No reason to add Fastify or Hono for a preview app that has no production traffic.

### D4 — esbuild over Vite for the server bundle

The server bundle is small (a few hundred lines of TypeScript). esbuild is the same pattern as `apps/web/server`. Vite is reserved for the browser bundle / dev server, which we do not need for a Node-side preview server.

### D5 — Vanilla JS in the preview chrome

The chrome needs dark toggle + viewport switcher + SSE listener. No framework is justified. The chrome file is plain HTML + a small `<script type="module">`.

### D6 — Tailwind `@source` directives point at the prototypes folder

Tailwind v4 scans source files when the `--watch` flag is on, but inside a built CSS we use `@source` to whitelist the prototype HTML so the JIT picks up their utility classes. Adding a prototype does not require touching the CSS entry — the next CSS rebuild picks up new utilities.

### D7 — Mobile-first viewport default

The preview chrome's default viewport is `desktop` so the developer sees the full layout, but every prototype must be designed mobile-first. The skill `themis-ui-prototype` enforces `?viewport=mobile` as the first visual check after authoring.

### D8 — Delete historical specs

Per the user's decision to "Borrar los archivos de spec viejos", delete both `2026-06-22-themis-web-app-redesign/` and `2026-06-23-themis-auth-fidelity-pass/` entirely. The completed work is captured in git history; the artifacts reference dead files. Keeping them around creates confusion for new contributors.

### D9 — Skill replacements

`themis-design-system` is replaced by `themis-ui-prototype` (workflow) plus two upstream skills:

- `impeccable-design-polish` — design polish pass.
- `login-flow` — auth pattern reference for future auth fidelity work.

The `brand-guidelines` skill from the open-design registry is intentionally not vendored. It points at Anthropic's official brand assets, which Themis does not use. The Themis brand contracts live in `docs/design-system/tokens.md` and `DESIGN.md`.

The existing skills (`frontend-design`, `tailwind-css-patterns`, `premium-frontend-ui`, `web-design-reviewer`, `ui-screenshots`, `accessibility`) stay installed.

## Context

### Tone

- All prose, identifiers, and commit messages stay in English per the workspace rules.
- The user-facing preview chrome copy is minimal: "Light", "Dark", "Mobile", "Tablet", "Desktop". No decorative copy.
- The seed prototype copy mirrors the auth shell recipe in `docs/design-system/recipes.md`.

### Stack

- Node 24+ (matches `apps/web/server`).
- Express 5 (matches `apps/web/api`).
- esbuild via `@nx/esbuild:esbuild` (matches `apps/web/server`).
- Tailwind v4 via `@tailwindcss/postcss` (matches the Angular app and the Astro site).
- No new top-level dependencies beyond Tailwind v4 and PostCSS (both already in the lockfile).
- No new Nx plugins beyond `@nx/eslint`, `@nx/esbuild`, `@nx/js`.

### Existing patterns to follow

- Project layout follows `apps/web/server/` (ESM, esbuild bundle, NodeNext TS).
- Lint config follows the workspace flat config in `eslint.config.mjs`.
- Tailwind import pattern follows `apps/web/app/src/styles.css` and `apps/web/site/src/styles/global.css`.
- The skill format follows the deleted `themis-design-system` skill structure (`SKILL.md` + `references/`).

### Open questions

None at spec time. The user answered the three scoping questions in the planning interview.
