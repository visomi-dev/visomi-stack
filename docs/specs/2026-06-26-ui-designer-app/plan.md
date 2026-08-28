# UI Designer App — Implementation Plan

## PR1 — Cleanup

Removes the vendored Open Design prototypes and the inherited design-system skill. Also removes the historical specs that referenced them so future readers do not chase dead links.

### Tasks

1. Delete `resources/open-design/themis-app/` (16 entries including HTML prototypes, artifact JSONs, critique JSON, and the `.od-skills/` folder).
2. Delete `.opencode/skills/themis-design-system/` (`SKILL.md`, `DESIGN.md`, `colors_and_type.css`, `assets_DESIGN.md`, `PROVENANCE.md`, `README.md`).
3. Delete `docs/specs/2026-06-22-themis-web-app-redesign/` (entire directory). It is a completed spec that depended on the vendored prototypes as visual references.
4. Delete `docs/specs/2026-06-23-themis-auth-fidelity-pass/` (entire directory). Same reason.
5. Delete `plan/feature-web-app-redesign-1.md`. The plan document is an artifact of the deleted web-app-redesign spec.
6. Edit `docs/constitution/roadmap.md`:
   - Remove the "## Auth Flow Fidelity Pass" section (the spec was deleted in step 4).
   - Replace the "## SSR Compatibility Hardening" link to the deleted catalyst spec only if it referenced the deleted specs; keep the entry otherwise.
   - Add a new "## UI Designer App" phase pointing at `docs/specs/2026-06-26-ui-designer-app/`.
7. Run `pnpm nx show projects` to confirm Nx is still clean. Run `git grep -n themis-design-system` and `git grep -n resources/open-design` to confirm no stragglers.

### Acceptance

- `pnpm nx show projects` lists the same projects as on `main` minus zero (the new ui-designer project lands in PR3, not PR1).
- `git grep -n themis-design-system` returns nothing.
- `git grep -n resources/open-design` returns nothing in the workspace tree.
- `docs/constitution/roadmap.md` no longer mentions "Open Design" or "themis-app".

## PR2 — Install upstream open-design skills

Three skills are vendored from `nexu-io/open-design` upstream into `.opencode/skills/`. Each is installed as a single folder copy that mirrors upstream's `SKILL.md` and any `references/` or `assets/` files. The skills are not modified — if Themis needs a divergent workflow, the `themis-ui-prototype` skill in PR4 is the customization point.

### Tasks

1. Download `skills/impeccable-design-polish/SKILL.md` (and any sibling files) from `https://github.com/nexu-io/open-design/tree/main/skills/impeccable-design-polish` and place under `.opencode/skills/impeccable-design-polish/`.
2. Same for `skills/login-flow/`.
3. Verify each `SKILL.md` has frontmatter (`name`, `description`) matching the upstream.
4. Add a `THEMIS_NOTES.md` inside each skill folder explaining the upstream version pinned and the date of vendoring. This makes future upgrades easy.

### Acceptance

- Two new folders under `.opencode/skills/`, each with a `SKILL.md` and a `THEMIS_NOTES.md` (login-flow also bundles `references/checklist.md`).
- `find .opencode/skills -name SKILL.md | wc -l` increases by two.
- No source files outside `.opencode/skills/` are touched.

## PR3 — Scaffold `apps/web/ui-designer`

The new Nx Node application plus its seed prototype and the first preview server.

### Tasks

1. Create `apps/web/ui-designer/` with the project layout described in `sdd.md`.
2. Author `apps/web/ui-designer/project.json` with targets:
   - `lint` → `@nx/eslint:lint`.
   - `build` → `@nx/esbuild:esbuild`, output to `dist/apps/web/ui-designer`, bundles `src/main.ts`, copies `src/prototypes/` and `src/preview/chrome.html` to `dist/.../public/`, runs PostCSS to build `dist/.../public/tailwind.css` from `styles.base.css` + a local `preview.css` with `@source` directives.
   - `serve` → `@nx/js:node`, continuous, dependsOn `build`, watches `src/**`.
3. Author `apps/web/ui-designer/tsconfig.app.json` extending `tsconfig.base.json`. Strict mode, target ES2023, NodeNext modules.
4. Author `apps/web/ui-designer/eslint.config.mjs` extending the workspace flat config; scope includes only `src/**`.
5. Author `src/main.ts` (Express bootstrap, listens on port 4300 by default, `PORT` env override).
6. Author `src/server.ts` (Express factory used by both `main.ts` and any future test harness).
7. Author `src/routes/index.ts`, `src/routes/preview.ts`, `src/routes/manifest.ts`, `src/routes/health.ts`.
8. Author `src/preview/render.ts` (wraps a prototype HTML in the chrome).
9. Author `src/preview/chrome.html` (toolbar with theme toggle + viewport switcher; vanilla JS for the toggles).
10. Author `src/preview/preview.css` with `@source './prototypes/**/*.html';` and `@source './preview/chrome.html';`.
11. Author the postcss step that the esbuild build invokes via the `plugins` option. Use `@tailwindcss/postcss`.
12. Author `src/prototypes/app-auth-shell.html` matching the auth shell recipe in `docs/design-system/recipes.md`.
13. Wire the `/events` SSE endpoint so the chrome auto-reloads when a prototype HTML file changes.
14. Bump `apps/web/app/version.json` from `1.3.0` to `1.4.0` (tooling app change).
15. Run `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build`, `pnpm nx serve ui-designer`, open `http://localhost:4300/`, open `http://localhost:4300/preview/app-auth-shell?viewport=mobile`, confirm the chrome and seed render correctly.

### Acceptance

- `pnpm nx run ui-designer:lint` passes.
- `pnpm nx run ui-designer:build --skip-nx-cache` produces `dist/apps/web/ui-designer/main.js` and `dist/apps/web/ui-designer/public/tailwind.css` and `dist/apps/web/ui-designer/public/prototypes/app-auth-shell.html`.
- `pnpm nx serve ui-designer` boots without errors on port 4300.
- `/` lists `app-auth-shell`.
- `/preview/app-auth-shell?viewport=mobile` renders the seed prototype at 375px and the dark toggle flips `html.dark`.
- `/healthz` returns `{ "ok": true }`.

## PR4 — Create the `themis-ui-prototype` skill

The new skill that drives the OpenCode workflow for the preview app. Replaces the deleted `themis-design-system` skill.

### Tasks

1. Author `.opencode/skills/themis-ui-prototype/SKILL.md` with frontmatter (`name`, `description`, `license: MIT`, `metadata.workflow: prototype`).
2. Document the workflow:
   - Step 0: read `docs/design-system/tokens.md` and `docs/design-system/recipes.md`.
   - Step 1: pick a slug (kebab-case).
   - Step 2: author `apps/web/ui-designer/src/prototypes/<slug>.html` using Tailwind utilities only — no semantic CSS, no raw hex, no `--tm-*` tokens.
   - Step 3: run `pnpm nx serve ui-designer` (or assume it is already running).
   - Step 4: open `http://localhost:4300/preview/<slug>?viewport=mobile` and verify light + dark.
   - Step 5: capture screenshots with the `ui-screenshots` skill at mobile (375), tablet (768), desktop (1280).
   - Step 6: review with the `web-design-reviewer` skill.
3. Hard rules section:
   - Always use Tailwind utilities from the workspace token set.
   - Mobile-first: `px-4 py-8` baseline, scale at `md:` and `lg:`.
   - Touch targets ≥ 44px (`min-h-11 min-w-11`).
   - Respect `prefers-reduced-motion`.
   - No raw hex colors; no `bg-[#…]` arbitrary values for token colors.
   - No `data-slot` or `data-od-id` required for prototypes — those are for the Angular app's e2e hooks only.
4. Companion references:
   - `references/tokens-cheatsheet.md` — minimal table mapping `bg-bg`, `bg-panel`, `bg-accent`, `text-fg`, `text-muted-fg`, `border-border`, `border-border-subtle` to their roles.
   - `references/chrome.md` — how to use the preview chrome (viewport switcher, dark toggle, SSE reload).
5. Update `docs/agents/design-system.md` to mention the new skill as the canonical reference for prototype work.
6. Update `AGENTS.md` to remove any reference to the deleted `themis-design-system` skill and point at the new one.

### Acceptance

- `.opencode/skills/themis-ui-prototype/SKILL.md` exists with valid frontmatter.
- The skill workflow is end-to-end runnable inside an OpenCode session: read tokens, create `apps/web/ui-designer/src/prototypes/example-empty-state.html`, preview it, screenshot it.
- `AGENTS.md` and `docs/agents/design-system.md` no longer mention `themis-design-system`.

## Cross-PR Verification

After all four PRs land:

```bash
pnpm nx run-many -t lint --projects=ui-designer,app,site,api,server,worker,realtime
pnpm nx run ui-designer:build --skip-nx-cache
pnpm nx serve ui-designer &
sleep 5
curl http://localhost:4300/healthz
curl http://localhost:4300/api/prototypes
curl -o /dev/null -w '%{http_code}' http://localhost:4300/preview/app-auth-shell
```

- All lints pass.
- Health endpoint returns `{"ok":true}`.
- Manifest endpoint returns the seed prototype.
- Preview endpoint returns 200.

Manual visual check on `/preview/app-auth-shell` at all three viewport presets and both light/dark themes.
