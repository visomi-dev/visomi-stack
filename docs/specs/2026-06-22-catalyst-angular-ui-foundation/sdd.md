# Catalyst Angular UI Foundation — Software Design Document

## Decision

Build the UI foundation first, isolated from the app redesign. The foundation lives in `apps/web/app/src/app/shared/ui` and provides Angular-native primitives inspired by Catalyst's visual language and Nive's Angular structure.

This foundation must be stable enough for the second spec, `Themis Web App Redesign`, to consume without needing route-specific UI hacks.

## Target Structure

```text
apps/web/app/src/app/shared/ui/
├── actions/
│   ├── button/
│   ├── icon-button/
│   └── link-button/
├── data/
│   ├── avatar/
│   ├── badge/
│   ├── description-list/
│   ├── pagination/
│   └── table/
├── forms/
│   ├── checkbox/
│   ├── field/
│   ├── fieldset/
│   ├── input/
│   ├── input-group/
│   ├── radio-group/
│   ├── select/
│   ├── switch/
│   └── textarea/
├── layout/
│   ├── app-shell/
│   ├── auth-layout/
│   ├── container/
│   ├── page-header/
│   ├── sidebar/
│   ├── stacked-layout/
│   └── topbar/
├── overlays/
│   ├── alert/
│   ├── combobox/
│   ├── dialog/
│   ├── dropdown/
│   └── listbox/
└── typography/
    ├── divider/
    ├── heading/
    └── text/
```

## Styling Model

Components define local class maps close to their TypeScript class:

```ts
const buttonBase = /* tw */ 'relative isolate inline-flex items-baseline justify-center gap-x-2 rounded-lg ...';
const buttonVariants = Object.freeze({ ... });
```

Rules:

- Use `Object.freeze()` maps for variants, sizes, tones, and states.
- Use `computed()` for class resolution.
- Use `host` for structural classes.
- Keep `data-slot` on projected/internal elements for icons, labels, descriptions, and errors.
- Prefer native `hover:`, `active:`, and `focus-visible:` to Catalyst's React Headless UI `data-hover` where possible.

## Token Contract

Create or extend the token layer used by the app:

| Token                  | Usage              |
| ---------------------- | ------------------ |
| `--color-bg`           | General background |
| `--color-panel`        | Panels/cards       |
| `--color-panel-raised` | Elevated surfaces  |
| `--color-fg`           | Primary text       |
| `--color-muted-fg`     | Secondary text     |
| `--color-accent`       | Primary actions    |
| `--color-accent-fg`    | Text on accent     |
| `--color-danger`       | Errors/destructive |
| `--color-ring`         | Focus ring         |
| `--radius-control`     | Controls           |
| `--radius-panel`       | Panels             |

Initial mapping from existing Themis tokens:

| New            | Current Themis                                 |
| -------------- | ---------------------------------------------- |
| `bg`           | `background` / `surface`                       |
| `panel`        | `surface-container-low`                        |
| `panel-raised` | `surface-container` / `surface-container-high` |
| `fg`           | `on-surface`                                   |
| `muted-fg`     | `on-surface-variant`                           |
| `accent`       | `primary`                                      |
| `accent-fg`    | `on-primary`                                   |
| `danger`       | `error`                                        |
| `ring`         | `primary`                                      |

## Component API Pattern

Conceptual `Button` API:

```ts
type ButtonVariant = 'solid' | 'outline' | 'plain';
type ButtonTone = 'default' | 'accent' | 'danger' | 'success' | 'warning';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
```

Expected inputs:

- `variant = input<ButtonVariant>('solid')`
- `tone = input<ButtonTone>('default')`
- `size = input<ButtonSize>('md')`
- `type = input<'button' | 'submit' | 'reset'>('button')`
- `disabled = input(false, { transform: booleanAttribute })`
- `loading = input(false, { transform: booleanAttribute })`

Outputs should only exist when the component abstracts behavior. Native interactions should remain native.

## Forms Strategy

- Prefer Signal Forms for new form work where the Angular 22 API fits.
- Keep visual wrappers agnostic to the forms engine so they can support native controls, `formControlName`, or signal field bindings.
- Replace `app-form-field` PrimeNG dependency with local `Field`, `Description`, and `ErrorMessage` primitives.
- Model invalid, disabled, loading, and described-by states explicitly.

## Overlay Strategy

Catalyst uses Headless UI for dialog, dropdown, combobox, and listbox. Angular implementation should use:

1. Angular CDK for overlay, focus trap, portal, and a11y.
2. Minimal in-house behavior only for simple primitives.
3. Deferred implementation for complex controls until actions/forms/layout are stable.

## Documentation Output

Create documentation that makes the foundation portable:

```text
docs/design-system/
├── tokens.md
├── components.md
├── recipes.md
├── accessibility.md
└── open-design-agent-rules.md
```

## Risks

| Risk                                           | Mitigation                                                      |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Literal Catalyst ports feel un-Angular         | Adapt APIs manually and keep only visual/behavioral patterns    |
| Overlay components take too long               | Prioritize actions/forms/layout; use Angular CDK for overlay    |
| Dynamic Tailwind classes are not detected      | Keep literal classes in maps and templates                      |
| Custom controls miss accessibility details     | Add unit and keyboard tests for primitives with real behavior   |
| Components become too Themis-specific too soon | Keep domain imports out of `shared/ui`; document copyable usage |

## Success Criteria

- New UI can be built without PrimeNG components.
- `shared/ui` has stable actions, typography, forms, and layout primitives.
- The components are Angular 22 compliant and use signals where appropriate.
- The second redesign spec can consume these primitives without adding one-off route components for basic UI chrome.
