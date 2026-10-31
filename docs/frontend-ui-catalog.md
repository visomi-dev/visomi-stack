# Frontend UI catalog

## Sources and selection

This catalog compares the read-only UI implementations in Nive, archived
visomi-stack-v0 and the supplied TypeScript Catalyst kit. It retains this
workspace's zinc/blue palette, local fonts, standard Tailwind scales and shared
focus treatment. Reference-specific slate palettes, component tokens and form
models are not copied.

References inspected:

- Nive: `apps/web/app/src/app/shared/ui/`.
- visomi-stack-v0: `apps/web/app/src/app/shared/ui/` and the Astro site components.
- Catalyst: `typescript/` components, including their variants and named parts.

The shared library owns typed `component.classes(options)` recipes. Angular and
Astro own their native markup and interaction. No React, Headless UI or Angular
runtime is introduced into the website. Native forms keep their own values,
validation, events, disabled behavior and submission semantics.

## Selected component families

| Family                 | Shared export     | Reference basis                                    | Native surface                         |
| ---------------------- | ----------------- | -------------------------------------------------- | -------------------------------------- |
| Button and icon button | `button`          | All three                                          | `button`                               |
| Button link            | `linkButton`      | All three                                          | `a`                                    |
| Heading                | `heading`         | All three                                          | `h1`–`h6`                              |
| Text                   | `text`            | All three                                          | `p`, `span`                            |
| Inline/block code      | `code`            | Catalyst text; reference typography                | `code`                                 |
| Text link              | `link`            | All three                                          | `a`                                    |
| Divider                | `divider`         | All three                                          | `hr`                                   |
| Badge                  | `badge`           | All three                                          | `span`                                 |
| Avatar                 | `avatar`          | All three                                          | Initials or `img`                      |
| Table                  | `table`           | All three                                          | `table`, native cells                  |
| Description list       | `descriptionList` | All three                                          | `dl`, `dt`, `dd`                       |
| Pagination layout      | `pagination`      | All three                                          | Labelled `nav` and links               |
| Container              | `container`       | Nive/v0                                            | `div`                                  |
| Card                   | `card`            | Nive/v0; Catalyst surface composition              | `article`, `section`                   |
| Page header            | `pageHeader`      | Nive/v0                                            | `header`                               |
| Application shell      | `appShell`        | Nive/v0, composition refactored                    | One main, skip link, responsive slots  |
| Sidebar                | `sidebar`         | Nive/v0                                            | Labelled nav, brand and footer slots   |
| Application header     | `topbar`          | Nive/v0                                            | Native header, title and action slots  |
| Mobile navigation      | `navbar`          | Nive/v0 bottom navigation                          | Labelled native nav                    |
| Navigation item        | `navItem`         | Nive/v0 sidebar and bottom items                   | Native anchor or action button         |
| Fieldset and legend    | `fieldset`        | All three                                          | `fieldset`, `legend`                   |
| Field                  | `field`           | All three                                          | `app-field` / Astro `div`              |
| Label                  | `label`           | All three                                          | `label`, `legend`                      |
| Description            | `description`     | All three                                          | `p`                                    |
| Error message          | `errorMessage`    | All three                                          | `p`                                    |
| Text input             | `input`           | All three                                          | Native text-like `input`               |
| Textarea               | `textarea`        | All three                                          | `textarea`                             |
| Select                 | `select`          | All three                                          | Native `select` and `option`           |
| Checkbox               | `checkbox`        | All three                                          | `input[type=checkbox]`                 |
| Radio                  | `radio`           | All three                                          | `input[type=radio]`                    |
| Switch                 | `toggle`          | All three                                          | Checkbox with switch semantics         |
| Radio card             | `radioCard`       | Nive/v0; Catalyst radio composition                | Label and native radio                 |
| Input group            | `inputGroup`      | All three                                          | Wrapper with projected adornments      |
| Inline feedback        | `alert`           | Adapted reference alert visuals                    | Non-modal message                      |
| Loader                 | `loader`          | Nive/v0                                            | Labelled status and decorative spinner |
| Disclosure             | `disclosure`      | Native counterpart to expandable reference content | `details`, `summary`                   |
| Dialog                 | `dialog`          | All three; native browser behavior                 | `dialog`                               |

## API and behavior boundaries

- Import individual recipes, for example `import { button, input } from
'@visomi-stack/web-frontend-ui'`.
- Use complete Tailwind literals. Both consumers scan the library source.
- Angular uses element-specific `appUI` directives. Ambiguous wrappers use values
  such as `appUI="card"`; checkbox and radio selectors are disjoint from text
  inputs and switches.
- Native inputs retain numeric `size`. Their visual size uses `uiSize` in Angular
  and `ui-size` in Astro; the
  shared recipe option remains `size`. Native `type`, `name`, `value`, `required`,
  `disabled`, labels and ARIA attributes are not replaced with form abstractions.
- Error appearance follows `aria-invalid`; messages must be associated through
  `aria-describedby`. A red border alone is not error feedback.
- Links navigate and buttons act. Button links do not emulate a disabled button.
- Avatar images require appropriate alternative text. Initials and loaders need
  contextual accessible names. Decorative icons are hidden from assistive tech.
- Table cells and description-list parts remain native children. Pagination is a
  link layout; route generation and page state belong to each application.
- Disclosure behavior comes from `details`. Modal opening uses `showModal()`;
  closing, Escape, focus containment and inert background use browser behavior.
  The dialog must have a title and an explicit close action.

## Components outside this selection

Dropdown menus, listboxes, comboboxes and custom tooltips depend on focus and
keyboard contracts beyond their CSS. They are not represented as equivalent
widgets by a styled native select or disclosure. Their headless primitive choice
needs its own implementation and accessibility validation.

Authentication layouts, password strength, PIN input, specialized password/color controls and financial
formatting remain application-specific compositions. The catalog does not port
Nive's product logic or authentication flows. Native controls compose with the
application's Signal Forms or Reactive Forms model.

## Shell reference refactor

The Nive/v0 shell, sidebar, topbar, bottom-navigation and stacked-layout files
were inspected as read-only references. Their layout responsibilities are kept,
while their routing facades, product navigation, icon runtime, component tokens
and off-canvas overlay implementation are not copied. A CSS-translated drawer
without focus containment is not an accessible modal navigation solution.

The new shell uses a desktop sidebar and an alternative mobile navbar. It owns
layout, a skip link, one main landmark and safe-area spacing. Sidebar and Topbar
own their projected structure. Native navigation items and Navbar only add
appearance, so Angular implements them as directives. Routing, current-page
matching, actions and navigation content stay with the application. A stacked
shell variant supports layouts that provide desktop navigation in the header.

See the [library usage](../libs/web/frontend/ui/README.md#application-shell-and-navigation)
for slots, required labels, stable IDs, routing and viewport behavior. The
localized full-page Astro demos at `/en/ui/shell/` and `/es/ui/shell/` avoid nesting
main landmarks in the catalog. The Angular foundation page uses the same shell.
No framework runtime or new JavaScript is added to the website for layout.

## Documentation and verification

The website provides localized live examples and Angular/Astro usage at
`/en/ui/` and `/es/ui/`. Examples use synthetic content and submit no data.
The Angular adapters are checked through native-control integration tests; the
website examples exercise the same shared recipes with SSR and small native
browser enhancements only.

## Field and table behavior

Field error behavior follows the Nive/v0 interaction policy: native user-invalid,
ARIA-invalid and manual errors reveal after blur; editing collapses the message;
submitted forms also expose errors for empty required controls. A `compact`
option adjusts both field gaps and collapsed error spacing. The caller owns the
submitted flag and validation values. Field components own their label,
description and error markup and project the native control. Both error-message
adapters generate their inner animation span. An intrinsic CSS Grid transition
replaces the references' fixed `max-height` cap, so long messages are not clipped.
Empty messages collapse and reduced motion disables the transition. All state
selectors live in the shared recipes rather than `styles.base.css`.

The reference table's `mobileCards` option is implemented as a responsive layout:
body rows become labelled cards below `md`, then restore columns. It does not
expand and collapse row details. `stickyHeaders` fixes desktop column headings
within an overflow container. Native headers, caption, explicit roles and
header/cell associations remain in the markup; decorative mobile labels are
hidden from assistive technology. Neither feature adds a website framework or
client table-conversion script.

The website catalog demonstrates both behaviors. Angular's foundations page
also includes a Signal Forms validation sample and the same responsive table.
Browser coverage checks native and Signal Forms errors, focus/reset/submission,
empty and long messages, reduced motion, no-JavaScript validation, mobile labels,
header semantics and actual header position while scrolling.

## Choosing the Angular abstraction

The repository's durable rule is in `AGENTS.md`, mirrored in `CLAUDE.md`.
Choose a directive to extend an existing element without owning a template;
choose a component for required markup or structural accessibility behavior.
A native host and a component are compatible: `ErrorMessage` is a component on
`p[app-error]`, while `Field` is a composition component with projected controls.
Buttons, inputs, selects and the styling-only table remain directives.

`Field` takes a small presentation API (`control-id`, `label`, `description`,
`error`, `compact`, `invalid`, `manual-error`) in both framework templates.
Angular keeps camelCase TypeScript members behind explicit input aliases.
The components derive stable association IDs;
Angular also exposes helpers for native bindings. They do not take ownership of
form values, validators or submission policy. Projected Signal Forms and
Reactive Forms controls remain native; no new form abstraction is introduced.

Angular references: [directive responsibilities](https://angular.dev/guide/directives),
[native component selectors](https://angular.dev/guide/components/selectors#when-to-use-an-attribute-selector)
and [content projection](https://angular.dev/guide/components/content-projection).
