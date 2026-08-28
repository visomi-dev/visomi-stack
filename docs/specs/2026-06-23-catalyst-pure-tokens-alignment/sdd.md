# Catalyst Pure Tokens Alignment — Software Design Document

## Decision

Replace the Material 3 token foundation in `styles.base.css` with a **pure Catalyst `@theme` token block** that uses Tailwind v4 standard color names directly. The Themis brand color is `blue-600` (`#2563eb`). The only public token names that survive are the Catalyst semantic set: `bg`, `panel`, `panel-raised`, `fg`, `muted-fg`, `accent`, `accent-fg`, `danger`, `danger-fg`, `ring`, `border`, `border-subtle`. The Open Design package at `~/.od/projects/ds-themis-is-a-developer-native-design-system/` is realigned in lockstep so the package and the app share the same token source.

This is a token-level alignment of the existing Catalyst Angular foundation (`2026-06-22-catalyst-angular-ui-foundation/`). It does not change component APIs, does not add or remove primitives, and does not redesign routes. The work is split into:

- Phase 0: external package realignment (manual edit outside the Nx workspace).
- Phase 1 (PR1): token foundation in `eager-circuit`.
- Phase 2 (PR2): component pattern alignment in `eager-circuit`.

## Rationale

The current implementation is a hybrid: Material 3 tokens with a Catalyst-style alias layer on top. The alias layer means components like `Button` use the right names (`bg-accent`, `bg-panel-raised`) but the resolved colors come from Material 3 surfaces and the Material 3 blue (`#1b4490`). The visual identity does not match Catalyst, and the Open Design package uses a third palette (`--tm-*`).

Replacing the foundation with pure Catalyst tokens:

1. Makes the Tailwind v4 color system the implementation source of truth. Components compose with `bg-accent`, `text-fg`, `border-border`, and `data-*` state attributes. The `bg` / `panel` / `accent` names match Catalyst's mental model exactly.
2. Removes 30+ Material 3 token definitions that no component uses after the realignment.
3. Lets the Open Design package, the Angular app, and any future consumer share the same token file. The package becomes a documentation layer, not a parallel palette.

## Architecture

### Token Layer

`styles.base.css` `@theme` block defines:

```text
--color-bg, --color-panel, --color-panel-raised
--color-fg, --color-muted-fg
--color-accent, --color-accent-fg
--color-danger, --color-danger-fg
--color-ring, --color-border, --color-border-subtle
--font-sans, --font-heading, --font-mono
--radius-sm, --radius-control, --radius-panel
--shadow-panel
```

`html.dark` redefines the same set with the dark mode Tailwind values from `requirements.md`.

The `ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, and `ui-text-rhythm` `@utility` blocks continue to read the new tokens.

### Component Layer

Components consume the tokens through Tailwind utilities:

- Backgrounds: `bg-bg`, `bg-panel`, `bg-panel-raised`, `bg-accent`, `bg-accent/10`, `bg-danger`.
- Text: `text-fg`, `text-muted-fg`, `text-accent`, `text-accent-fg`, `text-danger`.
- Borders: `border-border`, `border-border-subtle`, `border-accent`, `border-danger`.
- States: `data-hover:*`, `data-active:*`, `data-checked:*`, `data-current:*`, `data-invalid:*`, `data-loading:*`.

`Button` (and the other action components) use the Catalyst `--btn-bg` / `--btn-border` / `--btn-icon` / `--btn-hover-overlay` custom properties, set as inline Tailwind arbitrary values (`[--btn-bg:var(--color-blue-600)]`). The `before:` / `after:` pseudo-elements handle the optical border and the inset highlight shadow.

### External Package Layer

`~/.od/projects/ds-themis-is-a-developer-native-design-system/colors_and_type.css` becomes a documentation shim that:

- References the same Tailwind v4 colors through `var(--color-blue-600)` etc.
- Exposes the same token names so the React `ui_kits/app/components/*.jsx` files compile without changing their structure.
- Drops the AI-violet, indigo, and Material 3 surface palette.

The package's `DESIGN.md`, `SKILL.md`, `README.md`, `provenance.md`, and `preview/*.html` files are updated to describe the new direction.

## Risks

| Risk                                                      | Mitigation                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Tailwind v4 class detection misses dynamic class names    | Use literal classes in maps and templates; rely on `data-*` selectors instead of dynamic strings   |
| Dark mode contrast fails for `blue-500` on `zinc-900`     | Verify the pair in the validation phase; fall back to `blue-400` if needed                         |
| External package drift between manual edit and app tokens | Land the external edit **before** the in-repo PRs, and verify both renders in the same browser     |
| Button optical border regression on small sizes           | Test `sm`, `md`, `lg` button sizes in the visual check; document the chosen `radius` value         |
| Scope creep into route-level UI changes                   | Phase 2 is strictly limited to `shared/ui`; any change to a route component belongs in a follow-up |

## Alternatives Considered

1. **Keep the Material 3 token names, swap the values.** Rejected: the user wants Catalyst naming and visual language, not a recolored Material 3.
2. **Add a Catalyst namespace on top of Material 3.** Rejected: the current implementation already does this; the user explicitly wants the Material 3 layer removed.
3. **Use a different brand color (custom HSL palette).** Rejected: `blue-600` is the standard Catalyst color and matches the user's preference for the smallest change that still aligns to Catalyst.
4. **Reintroduce AI-violet and indigo accents.** Deferred to a follow-up spec; the user wants the smallest visible change that brings the foundation to Catalyst.
5. **Move components into `libs/ui` as part of this work.** Rejected: out of scope for a token realignment.

## Success Criteria

- `styles.base.css` exposes only Catalyst-style tokens in `@theme`.
- `shared/ui` components compile, lint, test, and build with zero regressions.
- The Open Design package's `ui_kits/app/index.html` renders with the new blue accent and zinc surfaces in a browser.
- The `docs/design-system/tokens.md`, `components.md`, and `recipes.md` reflect the new tokens and patterns.
- `pnpm nx run app:lint`, `pnpm nx run app:vite:test`, and `pnpm nx run app:build --skip-nx-cache` all pass.
- The next foundation spec can be authored on top of these tokens without naming conflicts.
