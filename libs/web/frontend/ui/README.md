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

| Exports                                                                                                                                                                                     | Options and defaults                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `button`, `linkButton`                                                                                                                                                                      | `variant: primary \| secondary \| danger \| ghost` (primary), `size: sm \| md \| lg \| icon` (md) |
| `heading`                                                                                                                                                                                   | `size: sm \| md \| lg \| xl` (lg)                                                                 |
| `text`                                                                                                                                                                                      | `size: sm \| md \| lg` (md), `tone: default \| muted` (default)                                   |
| `code`                                                                                                                                                                                      | `block: boolean` (false)                                                                          |
| `divider`                                                                                                                                                                                   | `soft: boolean` (false)                                                                           |
| `container`                                                                                                                                                                                 | `width: sm \| md \| lg \| full` (lg)                                                              |
| `card`                                                                                                                                                                                      | `tone: default \| raised \| ghost` (default), `padding: sm \| md \| lg` (md)                      |
| `badge`, `alert`                                                                                                                                                                            | `tone: neutral \| accent \| success \| warning \| danger` (neutral / accent)                      |
| `avatar`                                                                                                                                                                                    | `size: sm \| md \| lg` (md), `shape: circle \| rounded` (circle)                                  |
| `table`                                                                                                                                                                                     | `density: comfortable \| compact` (comfortable), `striped: boolean` (false)                       |
| `input`, `textarea`, `select`                                                                                                                                                               | `size: sm \| md \| lg` (md)                                                                       |
| `label`                                                                                                                                                                                     | `inline: boolean` (false)                                                                         |
| `dialog`                                                                                                                                                                                    | `size: sm \| md \| lg` (md)                                                                       |
| `link`, `pageHeader`, `descriptionList`, `pagination`, `fieldset`, `field`, `description`, `errorMessage`, `checkbox`, `radio`, `toggle`, `radioCard`, `inputGroup`, `loader`, `disclosure` | No visual options                                                                                 |

Buttons retain a minimum 44px target (48px for lg). Links use separate recipes
with native hover states and navigation semantics; there is no simulated disabled
link. Icon-only buttons need an accessible name. Input groups use
`data-slot="prefix"` / `data-slot="suffix"` for decorative adornments.

## Angular adapters

Import individual directives from `apps/web/app/src/app/ui`, or import the
`UI_DIRECTIVES` tuple in a component's `imports` for the complete set. The native
element determines the directive. Ambiguous elements use a static marker:

```html
<button appUI variant="secondary" size="sm">Cancel</button>
<a appUI="button" href="/app/en/">Continue</a>
<div appUI="field">
  <label appUI for="email">Email</label>
  <input appUI id="email" type="email" uiSize="sm" [size]="24" />
  <p appUI="description">Use a synthetic address.</p>
</div>
<label appUI inline><input appUI="switch" type="checkbox" /> Updates</label>
```

Visual size is `uiSize` except on buttons and button links, whose existing API
uses `size`. Native input `size` remains numeric. Directives compose with Angular
forms on native controls and do not provide their own value accessors.

Use static input types: Angular selects directives at compile time. Changing a
text input's type into checkbox/radio dynamically does not swap directives.
Markers include `badge`, `avatar`, `text` (span), `container`, `card` (section),
`pagination`, `field`, `description`, `error`, `switch`, `radio-card`,
`input-group`, `alert` and `loader`. Use `details appUI` for disclosure and
`dialog appUI #example="appUIDialog"` with `example.showModal()` / `example.close()`
for modal actions. Modal behavior is native; label the dialog and include a
close button. Host class bindings preserve additional caller classes.

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
