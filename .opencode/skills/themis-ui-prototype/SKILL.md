---
name: themis-ui-prototype
description: Author and preview Themis UI prototypes against the live Catalyst token set before implementation. Use this skill to compose a screen in HTML + Tailwind v4 utilities, render it in the local ui-designer preview server, and validate it across mobile, tablet, and desktop viewports in light and dark mode.
license: MIT
compatibility: opencode
metadata:
  audience: designers, frontend engineers
  workflow: prototype
---

# Themis UI Prototype

Author Themis prototypes that consume the live Catalyst Tailwind v4 token set and preview them at `http://localhost:4300/preview/<slug>` before any Angular code lands.

## What I do

- Compose a screen as a single self-contained HTML file under `apps/web/ui-designer/src/prototypes/<slug>.html`.
- Reuse the Themis tokens by linking `/public/tailwind.css` (the locally built stylesheet that imports `styles.base.css` + Tailwind utilities).
- Run `pnpm nx serve ui-designer` to expose the preview server at `http://localhost:4300/` with the index, manifest, and preview routes.
- Preview at `?viewport=mobile|tablet|desktop` and toggle `?theme=dark` on the iframe frame URL.
- Capture screenshots at the three viewport presets with the [`ui-screenshots`](../ui-screenshots/) skill.
- Review visual polish with the [`web-design-reviewer`](../web-design-reviewer/) skill.
- Polish typography and remove AI tells with the [`impeccable-design-polish`](../impeccable-design-polish/) skill.

## When to use me

Use this skill when a brief asks for a new Themis screen, an alternative layout for an existing route, or a quick visual exploration that should not yet touch the Angular app. Do not use it for production code in `apps/web/app` — that flows through the Angular component API and the `shared/ui` primitives.

## How to use

### Step 0 — Read the contracts

- [`/docs/design-system/tokens.md`](../../../docs/design-system/tokens.md) for the token vocabulary.
- [`/docs/design-system/recipes.md`](../../../docs/design-system/recipes.md) for layout rhythms (auth shell, app shell, project list, dialog, etc.).
- [`/docs/agents/design-system.md`](../../../docs/agents/design-system.md) for the workspace's Tailwind + accessibility rules.

### Step 1 — Pick a slug

Use kebab-case. Examples: `app-auth-shell`, `project-list-empty-state`, `sign-up-with-otp`. The slug becomes the filename and the preview URL path segment.

### Step 2 — Author the prototype

Create `apps/web/ui-designer/src/prototypes/<slug>.html`. The file must:

- Link the locally built stylesheet: `<link rel="stylesheet" href="/public/tailwind.css" />`.
- Use Tailwind utilities only. No raw hex colors. No `bg-[#…]` arbitrary values for token colors.
- Apply mobile-first spacing and scale up at `md:` and `lg:`.
- Use semantic HTML5 elements (`<main>`, `<article>`, `<header>`, `<form>`, `<button type="submit">`).
- Reach for `min-h-11 min-w-11` (44px) on every touch target.
- Skip `data-slot` and `data-od-id` — those are for Angular e2e hooks, not prototypes.

See [`references/tokens-cheatsheet.md`](./references/tokens-cheatsheet.md) for the minimal token table and [`references/auth-shell-template.html`](./references/auth-shell-template.html) for a worked example.

### Step 3 — Preview

```bash
pnpm nx run ui-designer:build-css --skip-nx-cache
pnpm nx serve ui-designer
```

Open:

- `http://localhost:4300/` — prototype index.
- `http://localhost:4300/preview/<slug>?viewport=mobile` — first visual check.
- `http://localhost:4300/preview/<slug>?viewport=tablet` — second.
- `http://localhost:4300/preview/<slug>?viewport=desktop` — third.

Toggle dark mode by replacing the iframe `src` with `/preview/<slug>/frame?theme=dark`. The chrome toolbar has a button that does this without leaving the page.

### Step 4 — Capture and review

Use the `ui-screenshots` skill to capture `screenshot-<slug>-mobile.png`, `screenshot-<slug>-tablet.png`, and `screenshot-<slug>-desktop.png` in both light and dark themes. Run the `web-design-reviewer` skill against the desktop screenshot for hierarchy, contrast, and breakpoint checks. Run `impeccable-design-polish` for the typography + AI-tell pass.

### Step 5 — Promote to Angular

Once approved, port the prototype into the Angular app:

1. Create the route under `apps/web/app/src/app/<feature>/`.
2. Replace raw Tailwind classes with the matching `shared/ui` primitives where one exists (`app-button`, `app-input`, `app-card`, etc.).
3. Wire real data through the Angular signal / RxJS pipeline.
4. Add Playwright snapshots + AXE checks under `apps/web/app-e2e/`.
5. Update `docs/design-system/recipes.md` if the new screen introduces a reusable pattern.

Do not commit the prototype HTML once the Angular version ships — the prototype is a transient artifact. Keep it locally if it is useful as a regression reference.

## Hard rules

- Mobile-first. Authoring starts at 375px and scales up.
- Tailwind utilities only. No custom CSS classes, no semantic BEM names.
- No raw hex colors. Reach for the built-in palette (`bg-white`, `bg-zinc-50`, `bg-blue-600`, `text-zinc-950`, etc.) until the Catalyst semantic tokens land in `styles.base.css`.
- 44px touch targets via `min-h-11 min-w-11`.
- Respect `prefers-reduced-motion` for any animation you add.
- The prototype HTML must be standalone: it links `/public/tailwind.css` and contains its own chrome. Do not rely on Angular components or PrimeNG.

## Common anti-patterns

- Hard-coded breakpoints (`@media (min-width: 768px)`) — use Tailwind's `md:` variant instead.
- Decorative gradients, glow shadows, or generic "feature card" grids.
- Placeholder copy like `Lorem ipsum`, `Feature One`, `Click here`.
- Inverted or muted link colors without an underline — links must be obvious.
- `<button>` without `type="button"` or `type="submit"` (default submit on a form causes surprises).

## Reference

- [`references/tokens-cheatsheet.md`](./references/tokens-cheatsheet.md)
- [`references/auth-shell-template.html`](./references/auth-shell-template.html)
- [`references/preview-chrome.md`](./references/preview-chrome.md)