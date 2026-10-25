---
name: tailwind-css-patterns
description: Provides comprehensive Tailwind CSS utility-first styling patterns including responsive design, layout utilities, flexbox, grid, spacing, typography, colors, and modern CSS best practices. Use when styling Angular or other existing framework components, building responsive layouts, implementing design systems, or optimizing CSS workflow.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Tailwind CSS Development Patterns

Expert guide for building modern, responsive user interfaces with Tailwind CSS utility-first framework. Covers v4.1+ features including CSS-first configuration, custom utilities, and enhanced developer experience.

## Overview

Provides actionable patterns for responsive, accessible UIs with Tailwind CSS v4.1+. Inspect the installed version, existing integration, and design tokens first. Apply v3 guidance only to an actual v3 project; do not migrate, install packages, or replace configuration implicitly. Use the repository package manager and configured Nx targets.

## When to Use

- Styling components in the project's actual framework, including Angular
- Building responsive layouts and grids
- Implementing design systems
- Adding dark mode support
- Optimizing CSS workflow

## Quick Reference

### Responsive Breakpoints

| Prefix | Min Width | Description   |
| ------ | --------- | ------------- |
| `sm:`  | 640px     | Small screens |
| `md:`  | 768px     | Tablets       |
| `lg:`  | 1024px    | Desktops      |
| `xl:`  | 1280px    | Large screens |
| `2xl:` | 1536px    | Extra large   |

### Common Patterns

```html
<!-- Center content -->
<div class="flex min-h-screen items-center justify-center">Content</div>

<!-- Responsive grid -->
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <!-- Items -->
</div>

<!-- Card component -->
<div class="rounded-lg bg-white p-6 shadow-lg">
  <h3 class="text-xl font-bold">Title</h3>
  <p class="text-gray-600">Description</p>
</div>
```

## Instructions

1. **Start Mobile-First**: Write base styles for mobile, add responsive prefixes (`sm:`, `md:`, `lg:`) for larger screens
2. **Use Design Tokens**: Leverage Tailwind's spacing, color, and typography scales
3. **Compose Utilities**: Combine multiple utilities for complex styles
4. **Extract Components**: Create reusable component classes for repeated patterns
5. **Configure Theme**: In v4, reuse CSS-first `@theme` tokens. A legacy JavaScript config is supported only when deliberately loaded with `@config`; do not create one by default.
6. **Verify Changes**: Test at each breakpoint using DevTools responsive mode. Check for visual regressions and accessibility issues before committing.

## Examples

### Responsive Card Component

<!-- Angular template example: reuse the project's semantic design tokens. -->
```html
<article class="overflow-hidden rounded-lg sm:flex">
  <img class="h-48 w-full object-cover sm:h-auto sm:w-48" [src]="product.image" [alt]="product.imageAlt" />
  <div class="p-6">
    <h3 class="text-lg font-semibold">{{ product.name }}</h3>
    <button type="button" class="mt-4 px-4 py-2 focus-visible:outline" (click)="addToCart(product)">
      Add to Cart
    </button>
  </div>
</article>
```

### Dark Mode Toggle

```html
<div class="bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
  <h1 class="dark:text-white">Title</h1>
</div>
```

### Form Input

```html
<label for="email">Email</label>
<input
  id="email"
  type="email"
  autocomplete="email"
  class="w-full rounded-lg border px-4 py-2 focus-visible:outline"
  placeholder="you@example.com"
/>
```

## Best Practices

1. **Consistent Spacing**: Use Tailwind's spacing scale (4, 8, 12, 16, etc.)
2. **Color Palette**: Reuse the project's semantic color tokens and contrast requirements
3. **Component Extraction**: Extract repeated patterns into reusable components
4. **Utility Composition**: Prefer utility classes over `@apply` for maintainability
5. **Semantic HTML**: Use proper HTML elements with Tailwind classes
6. **Performance**: Verify v4 source detection includes the project's Angular HTML/TypeScript and shared UI files; use explicit `@source` only where needed
7. **Accessibility**: Include focus styles, ARIA labels, and respect user preferences (reduced-motion)

## Troubleshooting

### Classes Not Applying

- **Check source detection**: In v4, inspect automatic detection and any `@source` declarations. In an actual v3 project, inspect its `content` configuration.
- **Verify build**: Run the affected project's existing Nx build target; do not assume an `npm run build` script exists.
- **Dev mode**: Reuse the existing dev target. If a separately approved v4 CLI workflow is needed, the CLI package is `@tailwindcss/cli`; do not fetch it implicitly.

### Responsive Styles Not Working

- **Check variants and generated CSS**: `flex md:flex` is valid. Class-attribute order does not determine CSS precedence; inspect responsive variants, conflicting utilities, and the generated stylesheet.
- **Check breakpoint values**: Verify breakpoints match your design requirements
- **DevTools**: Use browser DevTools responsive mode to test at each breakpoint

### Dark Mode Issues

- **Verify variant**: In v4, use the existing `dark` variant; a manual selector strategy can use `@custom-variant dark`. Legacy `darkMode` config applies only to a compatible, deliberately loaded setup.
- **Toggle implementation**: Preserve the application's existing theme mechanism and SSR-safe behavior.
- **Initial flash**: Use the existing initial-theme strategy rather than forcing dark mode.

## Constraints and Warnings

- **Class Proliferation**: Long class strings reduce readability; extract into components
- **Content Paths**: Misconfigured paths cause classes to be purged in production
- **Arbitrary Values**: Use sparingly; prefer design tokens for consistency
- **Specificity Issues**: Avoid `@apply` with complex selectors
- **Dark Mode**: Verify the intended media or custom-selector variant and both themes
- **Browser Support**: Check Tailwind docs for compatibility notes

## References

- **[references/layout-patterns.md](references/layout-patterns.md)** — Flexbox, grid, spacing, typography, colors
- **[references/component-patterns.md](references/component-patterns.md)** — Cards, navigation, forms, modals, React patterns
- **[references/responsive-design.md](references/responsive-design.md)** — Responsive patterns, dark mode, container queries
- **[references/animations.md](references/animations.md)** — Transitions, transforms, built-in animations, motion preferences
- **[references/performance.md](references/performance.md)** — Bundle optimization, CSS optimization, production builds
- **[references/accessibility.md](references/accessibility.md)** — Focus management, screen readers, color contrast, ARIA
- **[references/configuration.md](references/configuration.md)** — CSS-first config, JavaScript config, plugins, presets
- **[references/reference.md](references/reference.md)** — Additional reference materials

## External Resources

- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [v4 upgrade and legacy configuration guidance](https://tailwindcss.com/docs/upgrade-guide)
- [Tailwind UI](https://tailwindui.com)
- [Tailwind Play](https://play.tailwindcss.com)
