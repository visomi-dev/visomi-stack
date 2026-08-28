# UI Designer App — Validation

## Automated

### Lint

```bash
pnpm nx run ui-designer:lint
```

Must pass with zero errors. Warnings about Tailwind class detection in prototype HTML files are acceptable; those classes are not in TypeScript scope.

### Build

```bash
pnpm nx run ui-designer:build --skip-nx-cache
```

Must produce the following files:

- `dist/apps/web/ui-designer/main.js`
- `dist/apps/web/ui-designer/public/tailwind.css`
- `dist/apps/web/ui-designer/public/preview/chrome.html`
- `dist/apps/web/ui-designer/public/prototypes/app-auth-shell.html`

### Typecheck

The lint target covers typecheck via the workspace `tsc` settings. No separate `typecheck` target is required.

### Workspace lint after cleanup

```bash
pnpm nx run-many -t lint --projects=app,site,api,server,worker,realtime,ui-designer
```

After PR1 the existing projects must still lint clean. After PR4 the same applies, plus the new ui-designer project.

### Cleanup grep

```bash
git grep -n themis-design-system
git grep -n resources/open-design
```

Both must return zero matches in the workspace tree.

## Manual

### Cleanup walkthrough (PR1)

1. `git status` shows the four deletions (the two spec directories, the vendored folder, the skill folder) and the plan file deletion.
2. `git grep -n themis-design-system` returns zero matches.
3. `git grep -n resources/open-design` returns zero matches.
4. `docs/constitution/roadmap.md` lists the new UI Designer App phase and no longer mentions the Auth Flow Fidelity Pass phase.

### Skill install walkthrough (PR2)

1. `ls .opencode/skills/impeccable-design-polish/` shows `SKILL.md` and `THEMIS_NOTES.md`.
2. Same for `login-flow` (which also bundles `references/checklist.md`).
3. Open each `SKILL.md` and confirm the frontmatter has `name`, `description`, and a version pointer.
4. Open each `THEMIS_NOTES.md` and confirm the upstream URL + the vendoring date.
5. `find .opencode/skills -name SKILL.md | wc -l` should report two new entries versus `main`.

### UI designer walkthrough (PR3)

1. `pnpm nx run ui-designer:lint` passes.
2. `pnpm nx run ui-designer:build --skip-nx-cache` succeeds.
3. `pnpm nx serve ui-designer` boots without errors on port 4300.
4. Open `http://localhost:4300/` — the index lists `app-auth-shell`.
5. Open `http://localhost:4300/preview/app-auth-shell` — the seed renders inside the chrome at desktop width.
6. Click "Dark" in the chrome — the iframe's `html.dark` class flips and surfaces switch.
7. Click "Mobile" — the iframe viewport shrinks to 375px and the layout reflows (single column, full-width CTA).
8. Click "Tablet" — the iframe viewport is 768px.
9. Click "Desktop" — the iframe viewport is 1280px.
10. `curl http://localhost:4300/healthz` returns `{"ok":true}`.
11. `curl http://localhost:4300/api/prototypes` returns a JSON array containing `app-auth-shell`.
12. Edit `apps/web/ui-designer/src/prototypes/app-auth-shell.html`, save, watch the iframe reload within ~1 second via the SSE event.
13. Repeat steps 5–12 with `?viewport=mobile` in the URL to confirm the query string drives the viewport.
14. Edit `styles.base.css` (e.g., change `--color-accent` to a different blue). Re-run `pnpm nx run ui-designer:build --skip-nx-cache`. Confirm the prototype reflects the new accent.

### Skill walkthrough (PR4)

1. Open OpenCode with the new `themis-ui-prototype` skill available.
2. Run a prompt like: "Create a prototype called `example-empty-state` for an empty projects list. It should have an icon, a title, a one-line description, and a primary CTA. Use the Themis tokens and follow the auth shell recipe for layout rhythm."
3. Confirm the skill:
   - Reads `docs/design-system/tokens.md` and `docs/design-system/recipes.md`.
   - Authors `apps/web/ui-designer/src/prototypes/example-empty-state.html` using Tailwind utilities.
   - Opens the preview at `http://localhost:4300/preview/example-empty-state?viewport=mobile`.
   - Captures screenshots at mobile + tablet + desktop with the `ui-screenshots` skill.
   - Runs a review pass with the `web-design-reviewer` skill.
4. The output files exist on disk and the screenshots show a mobile-first layout that respects the Themis token vocabulary.

## Tone Check

- All commits and PR descriptions use English.
- The preview chrome copy is minimal: `Light`, `Dark`, `Mobile`, `Tablet`, `Desktop`. No decorative emojis.
- The seed prototype copy mirrors the auth shell recipe: "Sign in", "Account access" kicker, "Welcome back" subtitle, "Create an account" footer link.
- The skill `themis-ui-prototype` SKILL.md is in English, no decorative copy, no marketing language.

## Definition of Done

The spec is done when all four PRs are merged and the following are true on `main`:

1. `pnpm nx run ui-designer:lint` and `pnpm nx run ui-designer:build` pass.
2. `pnpm nx serve ui-designer` boots cleanly.
3. The preview at `/preview/app-auth-shell` renders correctly in light and dark mode at mobile, tablet, and desktop viewports.
4. `git grep -n themis-design-system` and `git grep -n resources/open-design` return zero matches.
5. The two upstream skills (`impeccable-design-polish`, `login-flow`) are installed and discoverable by OpenCode.
6. The `themis-ui-prototype` skill is installed, has valid frontmatter, and successfully drives the OpenCode workflow.
7. `docs/constitution/roadmap.md` reflects the new phase and does not reference the deleted auth fidelity pass.
8. `apps/web/app/version.json` is bumped to `1.4.0` (tooling app change).
