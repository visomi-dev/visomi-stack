# Frontend UI styles

Framework-independent Tailwind recipes, generated with `@nx/js:library` as an
internal, non-buildable library. Consumers compile the TypeScript source.
The library has no Angular, Astro, DOM or Node runtime dependencies.

```ts
import { button, input, badge, card } from '@visomi-stack/web-frontend-ui';

button.classes({ variant: 'secondary', size: 'sm' });
input.classes({ size: 'lg' });
badge.classes({ tone: 'success' });
card.classes({ tone: 'raised', padding: 'sm' });
```

The functions return class strings. Native values, validation, labels, events,
focus and form semantics remain the consumer's responsibility. Keep class names
complete and include this library's source in each application's Tailwind
`@source` declarations. Extra layout classes can live at the call site; the order
of conflicting utilities in a class string does not define precedence.

## Recipes and options

| Exports                                                                                                                                                                            | Options and defaults                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `button`, `linkButton`                                                                                                                                                             | `variant: primary \| secondary \| danger \| ghost` (primary), `size: sm \| md \| lg \| icon` (md)      |
| `heading`                                                                                                                                                                          | `size: sm \| md \| lg \| xl` (lg)                                                                      |
| `text`                                                                                                                                                                             | `size: sm \| md \| lg` (md), `tone: default \| muted` (default)                                        |
| `code`                                                                                                                                                                             | `block: boolean` (false)                                                                               |
| `divider`                                                                                                                                                                          | `soft: boolean` (false)                                                                                |
| `container`                                                                                                                                                                        | `width: sm \| md \| lg \| full` (lg)                                                                   |
| `card`                                                                                                                                                                             | `tone: default \| raised \| ghost` (default), `padding: sm \| md \| lg` (md)                           |
| `badge`, `alert`                                                                                                                                                                   | `tone: neutral \| accent \| success \| warning \| danger` (neutral / accent)                           |
| `avatar`                                                                                                                                                                           | `size: sm \| md \| lg` (md), `shape: circle \| rounded` (circle)                                       |
| `table`                                                                                                                                                                            | `density: comfortable \| compact` (comfortable), `striped`, `mobileCards`, `stickyHeaders` (all false) |
| `input`, `textarea`, `select`                                                                                                                                                      | `size: sm \| md \| lg` (md)                                                                            |
| `label`                                                                                                                                                                            | `inline: boolean` (false)                                                                              |
| `dialog`                                                                                                                                                                           | `size: sm \| md \| lg` (md)                                                                            |
| `field`                                                                                                                                                                            | `compact: boolean` (false)                                                                             |
| `link`, `pageHeader`, `descriptionList`, `pagination`, `fieldset`, `description`, `errorMessage`, `checkbox`, `radio`, `toggle`, `radioCard`, `inputGroup`, `loader`, `disclosure` | No visual options                                                                                      |

Buttons retain a minimum 44px target (48px for lg). Links use separate recipes
with native hover states and navigation semantics; there is no simulated disabled
link. Icon-only buttons need an accessible name. Input groups use
`data-slot="prefix"` / `data-slot="suffix"` for decorative adornments.

## Angular adapters

Import individual primitives from `apps/web/app/src/app/ui`, or import the
`UI_IMPORTS` tuple in a component's `imports` for the complete set. Directives
extend existing elements when they only need appearance or behavior. Components
own required internal markup. Both use the same portable class recipes.

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

The website catalog at `/en/ui/` and `/es/ui/` contains all 32 families with live
previews and Angular/Astro/recipe examples. Only the theme and small native demo
enhancements execute in the browser. The comparison, selection and exclusions
are documented in [the compendium](../../../../docs/frontend-ui-catalog.md).

## Checks

```sh
pnpm nx run-many -t lint,typecheck,typecheck-tests,test -p web-frontend-ui
pnpm nx run-many -t build,lint,typecheck,test -p web-app,web-site
pnpm nx run-many -t e2e -p web-app-e2e,web-site
```
