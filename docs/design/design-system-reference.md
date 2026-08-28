# Design System Reference

## Purpose

This document is the Themis design-token reference for public-site colors and typography.

When a screen export and a design-system asset disagree, the design-system asset should win for tokens.

## Source Assets

### Light

- Name: `Slate & Syntax`

### Dark

- Name: `Slate & Syntax: Night Edition`

## Typography

### Light

- headline: `Manrope`
- body: `Inter`
- label: `Inter`

### Dark

- headline: `Manrope`
- body: `Manrope`
- label: `Manrope`

## Light Token Reference

Primary:

- `primary`: `#385ca9`
- `on_primary`: `#f9f8ff`
- `primary_container`: `#a8c0ff`
- `on_primary_container`: `#063884`

Surface:

- `background`: `#faf8ff`
- `surface`: `#faf8ff`
- `surface_container_lowest`: `#ffffff`
- `surface_container_low`: `#f2f3ff`
- `surface_container`: `#e9edff`
- `surface_container_high`: `#e1e7ff`
- `surface_container_highest`: `#d9e2ff`

Text and structure:

- `on_surface`: `#213156`
- `on_surface_variant`: `#4e5e86`
- `outline`: `#6a7aa3`
- `outline_variant`: `#a1b1dd`

Accent:

- `tertiary`: `#006d4e`
- `on_tertiary`: `#e5fff0`
- `tertiary_container`: `#8dfece`
- `on_tertiary_container`: `#006146`

## Dark Token Reference

Primary:

- `primary`: `#7bd0ff`
- `on_primary`: `#004560`
- `primary_container`: `#004c69`
- `on_primary_container`: `#97d8ff`

Surface:

- `background`: `#070d1f`
- `surface`: `#070d1f`
- `surface_container_lowest`: `#000000`
- `surface_container_low`: `#09122b`
- `surface_container`: `#0a1839`
- `surface_container_high`: `#0b1d48`
- `surface_container_highest`: `#0a2257`

Text and structure:

- `on_surface`: `#dfe4ff`
- `on_surface_variant`: `#96a9e6`
- `outline`: `#6073ad`
- `outline_variant`: `#32457c`

Accent:

- `tertiary`: `#c6fff3`
- `on_tertiary`: `#00685c`
- `tertiary_container`: `#65fde6`
- `on_tertiary_container`: `#005e54`

## Implementation Notes

- The landing page should use the light token set in light mode and the night-edition token set in dark mode.
- Dark CTA styling should use the dark system primary and on-primary colors, not the light-mode CTA token pair.
- Dark body copy and labels should stay inside the night-edition palette, especially `on_surface` and `on_surface_variant`.
- Screen exports remain useful for layout, spacing, and section structure.

## Stored Verification Assets

The following dark landing references are stored locally for implementation verification:

- `docs/design/assets/themis-landing-page-dark-ai-integrated.html`
- `docs/design/assets/themis-landing-page-dark-ai-integrated.png`

For dark-mode landing work, these stored assets should be treated as the direct visual verification source.
