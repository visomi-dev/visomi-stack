# UI Designer App — Software Design Document

## Decision

Replace the Open Design vendored prototypes at `resources/open-design/themis-app/` and the inherited `themis-design-system` skill with a **first-party Node application** at `apps/web/ui-designer` that serves a local preview server, reuses the Themis Catalyst Tailwind v4 tokens and the `shared/ui` Angular primitive contract, and is paired with a new `themis-ui-prototype` opencode skill that drives the workflow.

The new application:

1. Lives inside the Nx workspace under `apps/web/ui-designer/`.
2. Is scaffolded with `@nx/esbuild:esbuild` + `@nx/js:node`, exactly like the existing `apps/web/server` app.
3. Bundles `styles.base.css` (workspace root) and Tailwind v4 utilities into a single CSS file delivered by the server, so prototypes inherit the same token vocabulary as the Angular app and the Astro site.
4. Exposes a tiny preview API: `GET /` lists prototypes, `GET /preview/:slug` renders one, `GET /api/prototypes` returns a JSON manifest. The server is Node-only — Bun is intentionally not supported to stay consistent with the rest of the workspace.
5. Ships one seed prototype (`app-auth-shell`) that re-uses the auth chrome recipe from `docs/design-system/recipes.md` so the first end-to-end preview is reviewable.
6. Is paired with a new `themis-ui-prototype` opencode skill (replacement for the deleted `themis-design-system` skill) that:
   - Reads `docs/design-system/tokens.md` and `docs/design-system/recipes.md` as the contract for tokens and primitives.
   - Creates new prototypes under `apps/web/ui-designer/src/prototypes/<slug>.html` using Tailwind utilities only — no semantic CSS classes, no raw hex colors, no legacy `--tm-*` tokens.
   - Runs `pnpm nx serve ui-designer` and verifies the preview at `http://localhost:4300/preview/<slug>`.

The skill cleanup removes the vendored Open Design prototypes and the inherited `themis-design-system` skill. The skill replacements — `impeccable-design-polish`, `login-flow` — are installed from `nexu-io/open-design` upstream to keep the design-craft toolbox current.

The work is split into four PRs:

- PR1: cleanup (delete `resources/open-design/themis-app/`, delete `.opencode/skills/themis-design-system/`, delete the historical specs that reference the vendored prototypes, update `docs/constitution/roadmap.md`).
- PR2: install the three upstream open-design skills.
- PR3: scaffold `apps/web/ui-designer` (project.json + esbuild config + preview server + `app-auth-shell` seed prototype + dark toggle + viewport switcher + watch mode).
- PR4: create the `themis-ui-prototype` opencode skill.

## Rationale

The current setup has three problems that block fast design iteration:

1. The vendored prototypes at `resources/open-design/themis-app/` use a third palette (`--tm-*`) that no longer matches the app's Catalyst + Tailwind v4 tokens. Auth fidelity work had to translate color names in both directions and still drifted.
2. The `themis-design-system` skill references that third palette and the static `colors_and_type.css` file. It cannot be reused as a workflow prompt for the real app.
3. There is no first-party way to validate a screen against the actual token file before opening a PR. Every fidelity pass re-derives styles by hand and ships screenshots as evidence.

A first-party preview app fixes all three:

- Reusing `styles.base.css` makes prototypes, the Angular app, and the Astro site share one token source. Editing a token in `styles.base.css` reflects in all three at the next build.
- A Node + Tailwind v4 + esbuild stack fits the existing Nx topology (`apps/web/server` uses the same triple) so no new infra decisions are needed.
- The `themis-ui-prototype` skill closes the loop with OpenCode: prompts can author a prototype, run the preview server, and visually verify it inside the same session.
- Bun is intentionally out of scope. Nx does not have a native Bun executor (`@nx/js:node`, `@nx/node:serve` both target Node), and adding a Bun runtime target would split the deployment story for a server that has no Bun-specific dependencies.

The two upstream skills (`impeccable-design-polish`, `login-flow`) fill the gaps left by deleting `themis-design-system`. The existing skills (`frontend-design`, `tailwind-css-patterns`, `premium-frontend-ui`, `web-design-reviewer`, `ui-screenshots`, `accessibility`) already cover the craft, review, screenshot, and a11y loops, so no other open-design skills need to be vendored.

## Architecture

### Project Layout

```
apps/web/ui-designer/
├── project.json                    # Nx project: lint, build, serve, dev
├── tsconfig.app.json               # TS strict, NodeNext, target ES2023
├── tsconfig.json
├── src/
│   ├── main.ts                     # Express bootstrap, middleware, routes
│   ├── server.ts                   # Factory that returns the Express app
│   ├── routes/
│   │   ├── index.ts                # GET / — prototype index page
│   │   ├── preview.ts              # GET /preview/:slug — render prototype
│   │   └── manifest.ts             # GET /api/prototypes — JSON
│   ├── preview/
│   │   ├── render.ts               # Wrap raw HTML with the preview chrome
│   │   ├── chrome.html             # Toolbar, dark toggle, viewport switcher
│   │   └── tokens.css.ts           # Reads styles.base.css from workspace root
│   └── prototypes/
│       └── app-auth-shell.html     # Seed prototype (PR3)
```

### Server Stack

- Runtime: Node 24+ (matches `apps/web/server`, `apps/web/api`).
- HTTP framework: Express 5 (matches `apps/web/api`, `apps/web/server`).
- Bundler: `@nx/esbuild:esbuild` produces `dist/apps/web/ui-designer/main.js` plus a `dist/apps/web/ui-designer/public/` folder holding the generated CSS and the prototype HTML files copied from `src/prototypes/`.
- Executor: `@nx/js:node` for `serve` (continuous watch on `src/**`).
- Linter: `@nx/eslint:lint` with the workspace flat config.
- No `e2e` target in PR3; manual visual review is enough for a preview app.

### CSS Pipeline

`styles.base.css` lives at the workspace root. The esbuild bundle copies it to `dist/apps/web/ui-designer/public/styles.base.css` and pipes it through `@tailwindcss/postcss` to produce `dist/apps/web/ui-designer/public/tailwind.css`. The preview chrome and every prototype HTML link that generated file directly — no manual `@import` of token variables.

```css
/* apps/web/ui-designer/public/preview.css built by PostCSS */
@import '../../../../../styles.base.css';
@import 'tailwindcss/preflight';
@source './prototypes/**/*.html';
@source './preview/chrome.html';
```

The `@source` directives make Tailwind pick up utility classes used inside prototype HTML files at build time. Adding a new prototype requires no rebuild of the app code; the next CSS rebuild picks up new utilities.

### Preview Routes

- `GET /` renders a small index page (built from the same Tailwind source) listing all `*.html` files under `src/prototypes/` with their frontmatter `title`, `slug`, and a thumbnail if one is provided.
- `GET /preview/:slug` renders the prototype inside an iframe-style wrapper. The wrapper provides:
  - Toolbar with prototype title, light/dark toggle (toggles `<html class="dark">` on the iframe document), viewport switcher (`mobile 375`, `tablet 768`, `desktop 1280`).
  - A query-string-driven viewport contract: `?viewport=mobile|tablet|desktop`. The default is `desktop`.
- `GET /api/prototypes` returns JSON `{ slug, title, viewport, updatedAt }[]` for OpenCode to query.
- `GET /healthz` returns `{ ok: true }` for the `serve` target's readiness check.

### Watch + Live Reload

`@nx/js:node` watches `src/**/*.ts`. When a prototype HTML file or `styles.base.css` changes, the server re-copies it to `dist/.../public/` and sends a Server-Sent Event on `/events` that the preview chrome listens to in order to reload the iframe. This keeps the loop below one second without adding a third-party HMR dependency.

### Seed Prototype — `app-auth-shell`

The single seed prototype in PR3 reproduces the auth shell chrome from `docs/design-system/recipes.md` (header with brand + language switcher + theme toggle, single-column centered card with title + form + footer link). It is built with raw Tailwind utilities, not the Angular `shared/ui` primitives, so it serves as the reference for how a prototype is composed from Tailwind + tokens alone. The skill `themis-ui-prototype` will mirror this composition pattern.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>App Auth Shell</title>
    <link rel="stylesheet" href="/public/tailwind.css" />
  </head>
  <body class="bg-bg text-fg min-h-screen">
    <header class="border-border-subtle flex items-center justify-between border-b px-4 py-3 md:px-8">
      <a class="font-heading text-lg font-bold tracking-tight">Themis</a>
      <div class="flex items-center gap-2">
        <button class="ui-focus-ring rounded-md px-3 py-1.5 text-sm font-medium">Theme</button>
      </div>
    </header>
    <main class="mx-auto w-full max-w-md px-4 py-12 md:py-16">
      <!-- ... auth card content ... -->
    </main>
  </body>
</html>
```

### Skill Replacements

The deleted `themis-design-system` skill is replaced by:

| Replacement                 | Reason                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `themis-ui-prototype` (new) | Drives the OpenCode loop for this app: read tokens, create prototype, serve, verify, screenshot.   |
| `impeccable-design-polish`  | Polishing pass on rough prototypes (close to the deleted skill's role, but tokens-agnostic).       |
| `login-flow`                | Auth pattern reference; reusable for future auth fidelity passes that do not need full prototypes. |

The Themis brand lives in [`docs/design-system/tokens.md`](../../../docs/design-system/tokens.md) and [`DESIGN.md`](../../../DESIGN.md); no separate brand skill is needed. The other existing skills (`frontend-design`, `tailwind-css-patterns`, `premium-frontend-ui`, `web-design-reviewer`, `ui-screenshots`, `accessibility`) stay installed. The skill `themis-design-system` and the vendored folder `resources/open-design/themis-app/` are deleted.

### Nx Configuration Notes

- `apps/web/ui-designer/project.json` adds the project to Nx with tag `scope:client` (it is a client-facing tooling app).
- The new project is added to the `eslint`, `nx-mcp`, and `@nx/playwright/plugin` discovery automatically by glob.
- No `e2e` target in PR3. PR3 ships the app, the seed prototype, the index route, and the preview chrome. A Playwright snapshot test for the seed prototype can land in a follow-up PR.
- `nx.json` is unchanged: the existing target defaults apply.

## Out of Scope

- Bun runtime support. The user explicitly chose "Solo Node" to keep the workspace runtime uniform.
- A full visual regression harness. The `web-design-reviewer` and `ui-screenshots` skills cover the review loop manually; Playwright snapshot tests land in a follow-up spec.
- New Angular primitives. The seed prototype is hand-composed Tailwind, not an Angular component. The Angular app already consumes the `shared/ui` primitives.
- Migrating the Astro `apps/web/site` to consume the new preview app. The site can link to `/preview/<slug>` in design docs but the integration is a follow-up.
- A plugin system for user-supplied prototypes outside the `src/prototypes/` folder. PR3 ships a single seeded location.

## Verification

`pnpm nx run ui-designer:lint` and `pnpm nx run ui-designer:build` must pass. `pnpm nx serve ui-designer` must start on `http://localhost:4300`. Opening `/` lists the seed prototype. Opening `/preview/app-auth-shell?viewport=mobile` renders the seed inside a 375px viewport with the dark toggle and viewport switcher working.

Manual visual check against the auth shell recipe in `docs/design-system/recipes.md`: the layout matches the recipe's `<app-auth-layout>` + `<app-auth-card>` structure, mobile padding is `px-4`, the toolbar is reachable, and `html.dark` flips the surface ladder correctly.
