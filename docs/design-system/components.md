# Themis UI Components

Components live under `apps/web/app/src/app/shared/ui` and are imported directly from source files.
This catalog is generated from source by `scripts/generate-component-catalog.mjs`; do not edit by hand.

All component classes are composed from the **Catalyst** token set defined in [`tokens.md`](./tokens.md). Components use Tailwind utilities (`bg-accent`, `text-fg`, `border-border`) and `data-*` state selectors (`data-hover`, `data-current`, `data-invalid`, `data-checked`) instead of dynamic class names.

## Actions

### `<app-button>`

- Source: `apps/web/app/src/app/shared/ui/actions/button/button.ts`
- Template: `apps/web/app/src/app/shared/ui/actions/button/button.html`
- Styles: `apps/web/app/src/app/shared/ui/actions/button/button.css`
- Inputs:
  - `disabled?`
  - `fullWidth?`
  - `loading?`
  - `size?`
  - `tone?`
  - `type?`
  - `variant?`

### `<app-icon-button>`

- Source: `apps/web/app/src/app/shared/ui/actions/icon-button/icon-button.ts`
- Template: `apps/web/app/src/app/shared/ui/actions/icon-button/icon-button.html`
- Styles: `apps/web/app/src/app/shared/ui/actions/icon-button/icon-button.css`
- Inputs:
  - `disabled?`
  - `size?`
  - `tone?`
  - `type?`
  - `variant?`

### `<app-link-button>`

- Source: `apps/web/app/src/app/shared/ui/actions/link-button/link-button.ts`
- Template: `apps/web/app/src/app/shared/ui/actions/link-button/link-button.html`
- Styles: `apps/web/app/src/app/shared/ui/actions/link-button/link-button.css`
- Inputs:
  - `ariaLabel?`
  - `href?`
  - `routerLink?`
  - `size?`
  - `target?`
  - `tone?`
  - `variant?`

### `<app-touch-target>`

- Source: `apps/web/app/src/app/shared/ui/actions/touch-target/touch-target.ts`
- Template: `apps/web/app/src/app/shared/ui/actions/touch-target/touch-target.html`
- Styles: `apps/web/app/src/app/shared/ui/actions/touch-target/touch-target.css`

## Data

### `<app-avatar>`

- Source: `apps/web/app/src/app/shared/ui/data/avatar/avatar.ts`
- Template: `apps/web/app/src/app/shared/ui/data/avatar/avatar.html`
- Styles: `apps/web/app/src/app/shared/ui/data/avatar/avatar.css`
- Inputs:
  - `alt?`
  - `initials?`
  - `size?`
  - `src?`

### `<app-badge>`

- Source: `apps/web/app/src/app/shared/ui/data/badge/badge.ts`
- Template: `apps/web/app/src/app/shared/ui/data/badge/badge.html`
- Styles: `apps/web/app/src/app/shared/ui/data/badge/badge.css`
- Inputs:
  - `tone?`

### `<app-description-list>`

- Source: `apps/web/app/src/app/shared/ui/data/description-list/description-list.ts`
- Template: `apps/web/app/src/app/shared/ui/data/description-list/description-list.html`
- Styles: `apps/web/app/src/app/shared/ui/data/description-list/description-list.css`

### `<app-pagination>`

- Source: `apps/web/app/src/app/shared/ui/data/pagination/pagination.ts`
- Template: `apps/web/app/src/app/shared/ui/data/pagination/pagination.html`
- Styles: `apps/web/app/src/app/shared/ui/data/pagination/pagination.css`
- Inputs:
  - `page?`
  - `pageSize?`
  - `total?`
- Outputs:
  - `pageChange`

### `<app-table>`

- Source: `apps/web/app/src/app/shared/ui/data/table/table.ts`
- Template: `apps/web/app/src/app/shared/ui/data/table/table.html`
- Styles: `apps/web/app/src/app/shared/ui/data/table/table.css`
- Inputs:
  - `data?`
  - `dense?`
  - `mobileCards?`
  - `stickyHeaders?`

## Feedback

### `<app-loader>`

- Source: `apps/web/app/src/app/shared/ui/feedback/loader/loader.ts`
- Template: `apps/web/app/src/app/shared/ui/feedback/loader/loader.html`
- Styles: `apps/web/app/src/app/shared/ui/feedback/loader/loader.css`
- Inputs:
  - `active?`
  - `duration?`

## Forms

### `<app-checkbox>`

- Source: `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.css`
- Inputs:
  - `ariaDescribedBy?`
  - `controlId?`
  - `disabled?`
  - `invalid?`
  - `name?`
  - `required?`
- Outputs:
  - `checkedChange`

### `<app-color-picker>`

- Source: `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.css`
- Inputs:
  - `disabled?`
  - `label?`
  - `name?`
  - `options?`
  - `required?`
- Outputs:
  - `valueChange`

### `<app-description>`

- Source: `apps/web/app/src/app/shared/ui/forms/description/description.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/description/description.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/description/description.css`
- Inputs:
  - `id?`

### `<app-error-message>`

- Source: `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/error-message/error-message.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/error-message/error-message.css`
- Inputs:
  - `controlId?`
  - `withIcon?`

### `<app-field>`

- Source: `apps/web/app/src/app/shared/ui/forms/field/field.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/field/field.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/field/field.css`
- Inputs:
  - `compact?`
  - `invalid?`
  - `manualError?`

### `<app-fieldset>`

- Source: `apps/web/app/src/app/shared/ui/forms/fieldset/fieldset.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/fieldset/fieldset.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/fieldset/fieldset.css`
- Inputs:
  - `legend?`
  - `tone?`

### `<app-form>`

- Source: `apps/web/app/src/app/shared/ui/forms/form/form.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/form/form.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/form/form.css`
- Inputs:
  - `submitted?`
  - `novalidate?`
- Outputs:
  - `ngSubmit`

### `<app-input>`

- Source: `apps/web/app/src/app/shared/ui/forms/input/input.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/input/input.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/input/input.css`
- Inputs:
  - `ariaDescribedBy?`
  - `autocomplete?`
  - `controlId?`
  - `disabled?`
  - `invalid?`
  - `max?`
  - `maxLength?`
  - `min?`
  - `minLength?`
  - `name?`
  - `pattern?`
  - `placeholder?`
  - `required?`
  - `type?`
- Outputs:
  - `valueChange`

### `<app-input-group>`

- Source: `apps/web/app/src/app/shared/ui/forms/input-group/input-group.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/input-group/input-group.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/input-group/input-group.css`

### `<app-label>`

- Source: `apps/web/app/src/app/shared/ui/forms/label/label.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/label/label.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/label/label.css`
- Inputs:
  - `for?`
  - `tone?`

### `<app-password-input>`

- Source: `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/password-input/password-input.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/password-input/password-input.css`
- Inputs:
  - `ariaDescribedBy?`
  - `autocomplete?`
  - `controlId?`
  - `disabled?`
  - `invalid?`
  - `loading?`
  - `maxLength?`
  - `minLength?`
  - `name?`
  - `pattern?`
  - `placeholder?`
  - `required?`
  - `variant?`
- Outputs:
  - `valueChange`

### `<app-password-strength>`

- Source: `apps/web/app/src/app/shared/ui/forms/password-strength/password-strength.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/password-strength/password-strength.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/password-strength/password-strength.css`
- Inputs:
  - `id?`
  - `describedBy?`

### `<app-pin-input>`

- Source: `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.css`
- Inputs:
  - `ariaDescribedBy?`
  - `digits?`
  - `disabled?`
  - `idPrefix?`
  - `invalid?`
  - `label?`
  - `loading?`
  - `digitPattern?`
- Outputs:
  - `completed`
  - `valueChanges`

### `<app-radio-card>`

- Source: `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.css`
- Inputs:
  - `disabled?`
  - `inputId?`
  - `invalid?`
  - `name?`
  - `required?`
  - `toggleable?`
- Outputs:
  - `valueChange`

### `<app-radio-group>`

- Source: `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.css`
- Inputs:
  - `disabled?`
  - `invalid?`
  - `legend?`
  - `name?`
  - `options?`
  - `required?`
- Outputs:
  - `valueChange`

### `<app-select>`

- Source: `apps/web/app/src/app/shared/ui/forms/select/select.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/select/select.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/select/select.css`
- Inputs:
  - `ariaDescribedBy?`
  - `disabled?`
  - `id?`
  - `invalid?`
  - `name?`
  - `required?`
- Outputs:
  - `valueChange`

### `<app-switch>`

- Source: `apps/web/app/src/app/shared/ui/forms/switch/switch.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/switch/switch.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/switch/switch.css`
- Inputs:
  - `ariaDescribedBy?`
  - `ariaLabel?`
  - `disabled?`
  - `id?`
  - `invalid?`
  - `required?`
- Outputs:
  - `checkedChange`

### `<app-textarea>`

- Source: `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts`
- Template: `apps/web/app/src/app/shared/ui/forms/textarea/textarea.html`
- Styles: `apps/web/app/src/app/shared/ui/forms/textarea/textarea.css`
- Inputs:
  - `ariaDescribedBy?`
  - `controlId?`
  - `disabled?`
  - `invalid?`
  - `maxLength?`
  - `minLength?`
  - `name?`
  - `pattern?`
  - `placeholder?`
  - `required?`
  - `rows?`
- Outputs:
  - `valueChange`

## Layout

### `<app-app-shell>`

- Source: `apps/web/app/src/app/shared/ui/layout/app-shell/app-shell.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/app-shell/app-shell.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/app-shell/app-shell.css`
- Inputs:
  - `mobileMenuOpen?`
- Outputs:
  - `mobileMenuClose`

### `<app-auth-card>`

- Source: `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.css`
- Inputs:
  - `cardId?`
  - `tone?`

### `<app-auth-layout>`

- Source: `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.css`

### `<app-bottom-navigation>`

- Source: `apps/web/app/src/app/shared/ui/layout/bottom-navigation/bottom-navigation.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/bottom-navigation/bottom-navigation.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/bottom-navigation/bottom-navigation.css`
- Inputs:
  - `exact?`
- Outputs:
  - `pressed`

### `<app-card>`

- Source: `apps/web/app/src/app/shared/ui/layout/card/card.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/card/card.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/card/card.css`
- Inputs:
  - `cardId?`
  - `padding?`
  - `tone?`

### `<app-container>`

- Source: `apps/web/app/src/app/shared/ui/layout/container/container.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/container/container.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/container/container.css`
- Inputs:
  - `size?`

### `<app-lang-switcher>`

- Source: `apps/web/app/src/app/shared/ui/layout/lang-switcher/lang-switcher.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/lang-switcher/lang-switcher.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/lang-switcher/lang-switcher.css`
- Inputs:
  - `default?`
  - `storageKey?`

### `<app-page-header>`

- Source: `apps/web/app/src/app/shared/ui/layout/page-header/page-header.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/page-header/page-header.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/page-header/page-header.css`

### `<app-page-loader>`

- Source: `apps/web/app/src/app/shared/ui/layout/page-loader/page-loader.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/page-loader/page-loader.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/page-loader/page-loader.css`
- Inputs:
  - `loading?`
  - `navigating?`

### `<app-sidebar>`

- Source: `apps/web/app/src/app/shared/ui/layout/sidebar/sidebar.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/sidebar/sidebar.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/sidebar/sidebar.css`
- Inputs:
  - `href?`
  - `routerLink?`

### `<app-stacked-layout>`

- Source: `apps/web/app/src/app/shared/ui/layout/stacked-layout/stacked-layout.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/stacked-layout/stacked-layout.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/stacked-layout/stacked-layout.css`

### `<app-topbar>`

- Source: `apps/web/app/src/app/shared/ui/layout/topbar/topbar.ts`
- Template: `apps/web/app/src/app/shared/ui/layout/topbar/topbar.html`
- Styles: `apps/web/app/src/app/shared/ui/layout/topbar/topbar.css`
- Outputs:
  - `menuClick`

## Media

### `<app-icon>`

- Source: `apps/web/app/src/app/shared/ui/media/icon/icon.ts`
- Template: `apps/web/app/src/app/shared/ui/media/icon/icon.html`
- Styles: `apps/web/app/src/app/shared/ui/media/icon/icon.css`
- Inputs:
  - `ariaLabel?`

## Overlays

### `<app-alert>`

- Source: `apps/web/app/src/app/shared/ui/overlays/alert/alert.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/alert/alert.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/alert/alert.css`
- Inputs:
  - `tone?`
  - `variant?`

### `<app-combobox>`

- Source: `apps/web/app/src/app/shared/ui/overlays/combobox/combobox.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/combobox/combobox.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/combobox/combobox.css`
- Implements `ControlValueAccessor` (compatible with Signal Forms via the CVA interop).
- Inputs:
  - `ariaLabel?`
  - `id?`
  - `options?`
  - `placeholder?`
- Outputs:
  - `valueChange`

### `<app-dialog>`

- Source: `apps/web/app/src/app/shared/ui/overlays/dialog/dialog.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/dialog/dialog.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/dialog/dialog.css`
- Inputs:
  - `ariaLabelledBy?`
  - `open?`
- Outputs:
  - `closed`

### `<app-dropdown>`

- Source: `apps/web/app/src/app/shared/ui/overlays/dropdown/dropdown.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/dropdown/dropdown.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/dropdown/dropdown.css`
- Inputs:
  - `align?`
  - `disabled?`
- Outputs:
  - `openChange`

### `<app-listbox>`

- Source: `apps/web/app/src/app/shared/ui/overlays/listbox/listbox.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/listbox/listbox.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/listbox/listbox.css`
- Implements `ControlValueAccessor` (compatible with Signal Forms via the CVA interop).
- Inputs:
  - `ariaLabel?`
  - `disabled?`
  - `options?`
- Outputs:
  - `valueChange`

### `<app-tooltip>`

- Source: `apps/web/app/src/app/shared/ui/overlays/tooltip/tooltip.ts`
- Template: `apps/web/app/src/app/shared/ui/overlays/tooltip/tooltip.html`
- Styles: `apps/web/app/src/app/shared/ui/overlays/tooltip/tooltip.css`
- Inputs:
  - `position?`

## Typography

### `<app-divider>`

- Source: `apps/web/app/src/app/shared/ui/typography/divider/divider.ts`
- Template: `apps/web/app/src/app/shared/ui/typography/divider/divider.html`
- Styles: `apps/web/app/src/app/shared/ui/typography/divider/divider.css`
- Inputs:
  - `label?`

### `<app-heading>`

- Source: `apps/web/app/src/app/shared/ui/typography/heading/heading.ts`
- Template: `apps/web/app/src/app/shared/ui/typography/heading/heading.html`
- Styles: `apps/web/app/src/app/shared/ui/typography/heading/heading.css`
- Inputs:
  - `level?`

### `<app-link>`

- Source: `apps/web/app/src/app/shared/ui/typography/link/link.ts`
- Template: `apps/web/app/src/app/shared/ui/typography/link/link.html`
- Styles: `apps/web/app/src/app/shared/ui/typography/link/link.css`
- Inputs:
  - `disabled?`
  - `href?`
  - `routerLink?`

### `<app-text>`

- Source: `apps/web/app/src/app/shared/ui/typography/text/text.ts`
- Template: `apps/web/app/src/app/shared/ui/typography/text/text.html`
- Styles: `apps/web/app/src/app/shared/ui/typography/text/text.css`
- Inputs:
  - `size?`
  - `tone?`
