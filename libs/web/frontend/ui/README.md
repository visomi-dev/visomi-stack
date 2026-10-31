# Frontend UI

Framework-independent Tailwind recipes, generated with `@nx/js:library` as an
internal, non-buildable library. Consumers compile the TypeScript source.
The library has no Angular, Astro, DOM or Node runtime dependencies.

```ts
import { button, input, badge, card, link } from '@visomi-stack/web-frontend-ui';

button.classes({ variant: 'secondary', size: 'sm' });
input.classes({ size: 'lg' });
badge.classes({ tone: 'success' });
card.classes({ tone: 'raised', padding: 'sm' });
link.classes({ variant: 'muted', underline: 'hover' });
```

The functions return class strings. Native values, validation, labels, events,
focus and form semantics remain the consumer's responsibility. Keep class names
complete and include this library's source in each application's Tailwind
`@source` declarations. Extra layout classes can live at the call site; the order
of conflicting utilities in a class string does not define precedence.

## Application-owned themes

Theme behavior lives in each frontend rather than in the shared recipe library.
Angular and Astro independently own their TypeScript preference type, storage,
DOM updates and media listeners. Both retain the `visomi.theme` storage key and
support `light`, `dark` and `system`. Invalid values follow the system.

Angular uses the `Theme` service and `select[appUITheme]` directive from its
`ui/theme/` adapters. Add `appUI` separately for the existing select appearance:

```html
<select appUI appUITheme aria-label="Appearance">
  <option value="system">System</option>
  <option value="light">Light</option>
  <option value="dark">Dark</option>
</select>
```

Astro uses `components/theme-select.astro`, which retains the existing `Select`
props and projects the same native options. Both synchronize multiple controls,
persist selection when storage is available, and follow system changes in
`system` mode. Labels and translated options belong to each consumer.

Angular initializes the theme through its service after rendering. Astro
compiles the component script through its normal pipeline. Neither application
uses a separate theme build or bootstrap asset. Stored preferences apply when
the frontend code starts, so they may appear after the first paint.
See [web foundations](../../../../docs/web-foundations.md#themes-and-accessibility)
for the build and CSP contract.

## Recipes and options

| Exports                                                                                                                                                                    | Options and defaults                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button`, `linkButton`                                                                                                                                                     | `variant: primary \| secondary \| danger \| ghost` (primary), `size: sm \| md \| lg \| icon` (md)                                                               |
| `heading`                                                                                                                                                                  | `size: title \| label \| sm \| md \| lg \| xl \| section \| display \| hero` (lg), `tone: default \| accent \| inverse \| inherit` (default)                    |
| `text`                                                                                                                                                                     | `size: xs \| sm \| md \| lg \| lead \| inherit` (md), `tone: default \| muted \| subtle \| accent \| inverse \| inherit` (default); `weight`, `leading`, `mono` |
| `code`                                                                                                                                                                     | `block: boolean` (false), `variant: default \| plain \| terminal` (default)                                                                                     |
| `divider`                                                                                                                                                                  | `soft: boolean` (false)                                                                                                                                         |
| `container`                                                                                                                                                                | `width: sm \| md \| lg \| xl \| full` (lg), `gutter: default \| compact \| none` (default)                                                                      |
| `card`                                                                                                                                                                     | `tone: default \| raised \| ghost \| subtle \| accent \| inverse` (default), `padding: none \| sm \| md \| lg` (md), `layout: stack \| plain` (stack)           |
| `badge`, `alert`                                                                                                                                                           | `tone: neutral \| accent \| success \| warning \| danger` (neutral / accent)                                                                                    |
| `avatar`                                                                                                                                                                   | `size: sm \| md \| lg` (md), `shape: circle \| rounded` (circle)                                                                                                |
| `table`                                                                                                                                                                    | `density: comfortable \| compact` (comfortable), `striped`, `mobileCards`, `stickyHeaders` (all false)                                                          |
| `input`, `textarea`, `select`                                                                                                                                              | `size: xs \| sm \| md \| lg` (md); `select` also accepts `inline` (false)                                                                                       |
| `label`                                                                                                                                                                    | `inline: boolean` (false)                                                                                                                                       |
| `dialog`                                                                                                                                                                   | `size: sm \| md \| lg` (md)                                                                                                                                     |
| `appShell`                                                                                                                                                                 | `layout: sidebar \| stacked` (sidebar), on its frame/sidebar parts                                                                                              |
| `navItem`                                                                                                                                                                  | `placement: sidebar \| navbar` (sidebar)                                                                                                                        |
| `sidebar`, `topbar`, `navbar`                                                                                                                                              | No visual options                                                                                                                                               |
| `field`                                                                                                                                                                    | `compact: boolean` (false)                                                                                                                                      |
| `link`                                                                                                                                                                     | `variant: default \| muted \| inverse` (default), `underline: always \| hover \| none` (always)                                                                 |
| `pageHeader`, `descriptionList`, `pagination`, `fieldset`, `description`, `errorMessage`, `checkbox`, `radio`, `toggle`, `radioCard`, `inputGroup`, `loader`, `disclosure` | No visual options                                                                                                                                               |

Buttons retain a minimum 44px target (48px for lg). Links use separate recipes
with native hover states and navigation semantics; there is no simulated disabled
link. Icon-only buttons need an accessible name. Input groups use
`data-slot="prefix"` / `data-slot="suffix"` for decorative adornments.

## Angular adapters

Import individual primitives from `apps/web/app/src/app/ui`, or import the
`UI_IMPORTS` tuple in a component's `imports` for the complete set. Directives
extend existing elements when they only need appearance or behavior. Components
own required internal markup. Both use the same portable class recipes.

The Angular adapters are grouped by responsibility under `app/ui/`:
`actions/`, `typography/`, `layout/` (including shell and navigation), `data/`,
`forms/`, `feedback/`, `overlays/` and `theme/`. Focused tests live beside their subject;
`ui.spec.ts` covers the complete catalog. The root `ui/index.ts` remains the
public entry point for individual exports and `UI_IMPORTS`. Implementation files
import their siblings directly rather than importing the public barrel.

```html
<button appUI variant="secondary" size="sm">Cancel</button>
<a appUI="button" href="/app/en/">Continue</a>
<app-field
  #emailField="appField"
  controlId="email"
  label="Email"
  description="Use a synthetic address."
  error="Enter a valid email address."
>
  <input
    appUI
    [id]="emailField.controlId()"
    type="email"
    uiSize="sm"
    [size]="24"
    [attr.aria-describedby]="emailField.describedBy()"
  />
</app-field>
<p app-error>Standalone error message.</p>
<label appUI inline><input appUI="switch" type="checkbox" /> Updates</label>
```

`Field` is an `app-field` composition component. `ErrorMessage` is a component
on the native `p[app-error]` host and creates its own inner animation span. The
consumer never supplies that implementation wrapper. Components use kebab-case
selectors; directives retain the `appUI` convention. ESLint validates both
component selector kinds with the normal `app` prefix rule.

Visual size is `uiSize` except on buttons and button links, whose API uses `size`.
Native input `size` remains numeric. Projected controls keep their own native
attributes, events and Angular form bindings. The field adds no value accessor.

Use static input types: Angular selects directives at compile time. Changing a
text input's type into checkbox/radio dynamically does not swap directives.
Markers include `badge`, `avatar`, `text` (span), `container`, `card` (section),
`pagination`, `description`, `switch`, `radio-card`, `input-group`, `alert` and
`loader`. Use `details appUI` for disclosure and
`dialog appUI #example="appUIDialog"` with `example.showModal()` / `example.close()`
for modal actions. Host class bindings preserve additional caller classes.

## Application shell and navigation

`AppShell`, `Sidebar` and `Topbar` own composition markup. Angular uses
`app-shell`, `app-sidebar` and the native `header[app-topbar]` component.
`Navbar` (`nav[appUI=navbar]`) and `NavItem`
(`a[appUI=nav-item]`, `button[appUI=nav-item]`) are appearance directives.
Astro has matching server adapters: `app-shell.astro`, `sidebar.astro`,
`topbar.astro`, `navbar.astro` and `nav-item.astro` (a native anchor).

```html
<app-shell contentId="workspace-main" skipLabel="Skip to content">
  <app-sidebar label="Primary navigation">
    <a data-slot="brand" href="/app/en/">Workspace</a>
    <a appUI="nav-item" routerLink="/settings" routerLinkActive ariaCurrentWhenActive="page">Settings</a>
    <p data-slot="footer">Example workspace</p>
  </app-sidebar>
  <header app-topbar>
    <h1 data-slot="title">Overview</h1>
    <button appUI>Save</button>
  </header>
  <p>Page content goes directly into the shell-owned main.</p>
  <footer data-shell-footer>Page footer</footer>
  <nav appUI="navbar" aria-label="Primary navigation">
    <a appUI="nav-item" placement="navbar" routerLink="/settings" routerLinkActive ariaCurrentWhenActive="page"
      >Settings</a
    >
  </nav>
</app-shell>
```

The Angular consumer imports `RouterLink` / `RouterLinkActive` when using them;
the adapters do not wrap routing or copy its input API. The shell also accepts
`data-shell-sidebar`, `data-shell-header` and `data-shell-mobile` markers for
custom projected compositions. Astro uses named `sidebar`, `header`, `mobile`
and `footer` slots, with default content projected into its own main. Sidebar
uses `brand` and `footer` slots, and Topbar uses a `title` slot.

Both shell adapters require a stable unique `contentId` and localized
`skipLabel`. They own one focusable main and its skip link; do not nest a main
inside them. Sidebar requires a localized `label`; native nav elements require
an accessible name. Desktop starts at `lg` (1024px): the sidebar is sticky with
an independently scrollable navigation region, the header is sticky, and mobile
navigation leaves the accessibility tree. Below `lg`, the sidebar is hidden and
the shell docks the mobile slot at the bottom. Content padding and safe-area
spacing keep final actions clear of the dock. The header flows normally on
mobile, avoiding a tall sticky header covering content on narrow screens.

`layout="stacked"` removes the desktop sidebar column; supply desktop navigation
in the header for that layout. Without a shell, Sidebar, Topbar and Navbar remain
ordinary in-flow compositions suitable for previews or alternate page layouts.
Use three to five short labelled destinations in a mobile navbar. Keep all
necessary destinations reachable in both responsive layouts. Icons belong to
the consumer and should be decorative when paired with visible labels.

`navItem.classes({ placement: 'sidebar' | 'navbar' })` defaults to `sidebar`.
Current-page styling follows native `aria-current="page"`; callers own route
matching. Links keep href, RouterLink, query parameters, target and download.
Actions use native buttons with explicit `type="button"` and `disabled`; the
recipe does not simulate disabled links or turn navigation into an ARIA menu.

The shell recipe exposes `classes()`, `frameClasses({ layout })`,
`sidebarClasses({ layout })`, `headerClasses()`, `contentClasses()`,
`mobileClasses()` and `skipClasses()` for its owned parts. Sidebar also exposes
`navigationClasses()` and Topbar exposes `titleClasses()` / `actionsClasses()`.
The framework adapters own these wrappers; consumers only project meaningful
content. No route discovery, global navigation state, duplicated IDs, DOM
rewriting, modal drawer or client layout script is introduced.

Full Astro examples live at `/en/ui/shell/` and `/es/ui/shell/`; Angular's existing
localized foundation pages demonstrate the same shell. The Astro page loads
only its theme-control script, and works without JavaScript. Navigation markup
exists in both desktop and mobile slots, with exactly one version visible and
accessible at a time. There is no shared framework runtime.

## Text links

`link.classes({ variant, underline })` owns reusable link colors, underline
policy and keyboard focus. It keeps inline text geometry: no button sizing or
padding is introduced. Defaults preserve the original blue underlined link.

- `default` uses the accent color.
- `muted` uses neutral text with accent hover and native `aria-current="page"`
  styling for text navigation.
- `inverse` uses light text and a white focus outline for contrasting dark or
  colored surfaces, in both themes. It intentionally does not combine the
  regular focus utility's dark-mode color with its inverted focus treatment.
- `underline="hover"` reveals the underline on hover and keyboard focus;
  `always` and `none` retain explicit alternatives.

```html
<a appUI variant="muted" underline="hover" href="/guide">Guide</a>
```

```astro
<Link variant="muted" underline="hover" href="/guide">
  Guide
</Link>
<Link variant="inverse" href="/guide">
  Guide
</Link>
```

Both framework adapters expose the same typed options. Native anchor attributes,
RouterLink, query parameters and events remain consumer-owned. Page-specific
spacing, typography and icon placement stay at the call site. Brand marks,
linked cards and skip links retain the presentation owned by their composition;
they are not forced into a text-link style. No disabled-link behavior is added.

## Field validation and responsive tables

The Angular `Field` and Astro `Field` components require `controlId` and `label`.
They own the label, optional `description`, and `error` presentation, while
projecting the native control. They also accept `compact`, `invalid` and
`manualError` (string or null). A nonempty manual error overrides the normal
error text. Validation and the control's `aria-invalid` remain consumer-owned.

Provide a unique, stable control ID. Both components derive description and
error IDs as `<controlId>-help` and `<controlId>-error`. Angular exports the
instance as `appField`; bind the projected control's ID and `aria-describedby`
to its `controlId()` and `describedBy()` helpers. The latter omits empty message
IDs. Astro consumers use the same explicit IDs in their server markup. No global
ID counter or DOM rewriting is used, so SSR and hydration share the same IDs.

Errors stay collapsed while the field has focus and while its control is valid.
They reveal after blur for nonempty native `:user-invalid` or `aria-invalid`
controls and manual field errors. Set `data-submitted` on the form or an ancestor
when a submission/check is attempted so empty required fields also reveal errors
on blur. Remove that attribute when resetting the form. Empty required fields
need a placeholder for the pre-submission empty guard. Components remove empty
message space; CSS animates nonempty messages' grid tracks, opacity and spacing
without a fixed height cap. Reduced motion disables the transition.

```html
<form [attr.data-submitted]="attempted() ? '' : null">
  <app-field
    #emailField="appField"
    controlId="email"
    label="Email"
    [error]="emailError()"
    [manualError]="serverError()"
  >
    <input
      appUI
      type="email"
      [id]="emailField.controlId()"
      required
      placeholder="demo@example.test"
      [formField]="fields.email"
      [attr.aria-describedby]="emailField.describedBy()"
    />
  </app-field>
</form>
```

```astro
<Field controlId="email" label="Email" description="Use an example address." error="Enter a valid email address.">
  <Input type="email" id="email" required placeholder="demo@example.test" aria-describedby="email-help email-error" />
</Field>
```

`table.classes({ mobileCards: true, stickyHeaders: true })` converts body rows to
cards below `md`; from `md` it restores native column layout and optionally fixes
column headers within the nearest scrolling ancestor. `density` and `striped`
remain independent. The Angular `table[appUI]` and Astro `Table` adapters accept
the same boolean options. With both false, the existing table layout is retained.

Keep the caption, `scope` and `headers` associations. Use explicit `table`,
`rowgroup`, `row`, `columnheader`, `rowheader` and `cell` roles when applying the
responsive display changes. Column headers are visually clipped on mobile and
remain in the accessibility tree. Put each visible mobile label in a
`<span data-slot="label" aria-hidden="true">…</span>` inside its cell. This label
is hidden on desktop and does not duplicate the accessible cell value.
Use an overflow container for sticky headers and wider non-collapsing tables.

See the website table preview for complete native markup and both applications'
field samples for native validation and Signal Forms behavior.

## Astro adapters and documentation

Import the corresponding server component from
`apps/web/site/src/components/<name>.astro`. Visual options mirror Angular;
`Input` preserves numeric `size`, while `uiSize` selects appearance. `Avatar`
requires `label`, `Loader` requires `label`, and `Disclosure` requires `summary`.
`Dialog` requires `id` and browser code calling `showModal()` to open it.
Native attributes and slots are forwarded. No framework hydration is needed.

The website catalog at `/en/ui/` and `/es/ui/` contains all 37 families with live
previews and Angular/Astro/recipe examples. Only the theme and small native demo
enhancements execute in the browser. The comparison, selection and exclusions
are documented in [the compendium](../../../../docs/frontend-ui-catalog.md).

## Checks

```sh
pnpm nx run-many -t lint,typecheck,typecheck-tests,test -p web-frontend-ui
pnpm nx run-many -t build,lint,typecheck,test -p web-app,web-site
pnpm nx run-many -t e2e -p web-app-e2e,web-site
```

## Composing public pages

Public pages use the same heading, text, code, container, card, label, select,
badge and alert recipes as the app. Responsive heading sizes (`section`,
`display`, `hero`) express the existing marketing hierarchy; `label` supports
small section headings without changing their semantic level. Use an inverse
tone on a colored surface, rather than inheriting the default foreground.

Text supports `weight: inherit | normal | medium | semibold` (inherit),
`leading: default | relaxed` (default) and `mono` (false). `size="inherit"`
leaves sizing and leading to the surrounding composition. `tone="inherit"`
avoids overriding its foreground. Plain code inherits its surroundings;
terminal code supplies a dark surface. `code.captionClasses()` styles the
terminal caption; the terminal composition owns its figure, caption and pre.

Card's default stacked layout remains unchanged. Use `layout="plain"` when the
consumer owns a grid, flex direction or spacing, and `padding="none"` for
compositions with separately padded parts. Angular supports native article,
section (`appUI="card"`) and div (`appUI="card"`) hosts; Astro's `as` selects
article, section, div or figure. `select` keeps its default full width, while
`inline` supplies intrinsic width for header controls. The compact container
uses the public site's horizontal gutters, including the app-shell content.

A composition can apply a recipe directly when an adapter would add an
unnecessary wrapper: the public mobile menu uses native details/summary with
button-link classes on summary and card classes on nav; linked cards use
card classes on their native anchors. They keep native keyboard interaction
and destinations. Page grids, spacing, full-width section bands, brand marks,
illustration connectors and intentional foundation swatches stay with their
own compositions. Reuse visual primitives without inventing a generic wrapper
for every piece of markup or replacing native semantics.
