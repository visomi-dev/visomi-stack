# Themis UI Accessibility

- Interactive components must have accessible names.
- Icon-only buttons require `aria-label`.
- Form controls support `aria-describedby` and `aria-invalid`.
- Focus indicators use `ui-focus-ring` and must remain visible in light and dark mode.
- Touch targets should use `ui-touch-target` or provide at least 44px height and width.
- Dialogs trap focus, close on escape, and expose `role="dialog"` with `aria-modal="true"`.
- Listbox and combobox expose `role="listbox"`, `role="option"`, `aria-selected`, and active descendant state.
