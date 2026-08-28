# Tokens Cheatsheet

A minimal map of the Themis visual language to Tailwind v4 utilities. These are the safe defaults the `themis-ui-prototype` skill expects prototypes to use until the Catalyst semantic tokens (`bg-bg`, `bg-panel`, `bg-accent`) land in `styles.base.css` via the `2026-06-23-catalyst-pure-tokens-alignment` spec.

## Surfaces

| Role               | Light utility                                  | Dark utility                                    |
| ------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Page canvas        | `bg-white`                                     | `dark:bg-zinc-950`                              |
| Card / panel       | `bg-zinc-50` + `border-zinc-950/10`            | `dark:bg-zinc-900` + `dark:border-white/10`      |
| Raised panel       | `bg-zinc-100` + `border-zinc-950/10`           | `dark:bg-zinc-800` + `dark:border-white/10`     |
| Subtle divider     | `border-zinc-950/5`                            | `dark:border-white/5`                           |
| Quiet divider      | `border-zinc-950/10`                           | `dark:border-white/10`                          |

## Text

| Role               | Light utility                                  | Dark utility                                    |
| ------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Primary text       | `text-zinc-950`                                | `dark:text-zinc-50`                             |
| Secondary text     | `text-zinc-500`                                | `dark:text-zinc-400`                            |
| Inverse text       | `text-white`                                   | `text-white`                                    |
| Link text          | `text-blue-600`                                | `dark:text-blue-500`                            |

## Accent and Status

| Role               | Light                                          | Dark                                            |
| ------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Primary action     | `bg-blue-600 text-white hover:bg-blue-700`     | `dark:bg-blue-500`                              |
| Destructive        | `bg-red-600 text-white`                        | `dark:bg-red-500`                               |
| Success            | `bg-emerald-600 text-white`                    | `dark:bg-emerald-500`                           |
| Warning            | `bg-amber-500 text-zinc-950`                   | `dark:bg-amber-400`                              |

## Spacing

| Role               | Utility                                        |
| ------------------ | ---------------------------------------------- |
| Mobile page margin | `px-4`                                         |
| Tablet gutter      | `md:px-6`                                      |
| Desktop page margin | `md:px-8 lg:px-12`                            |
| Section padding    | `py-8 md:py-12 lg:py-16`                       |
| Card padding       | `p-4 md:p-6 lg:p-8`                            |
| Stack gap          | `gap-4 md:gap-6 lg:gap-8`                      |

## Radii

| Role               | Utility                                        |
| ------------------ | ---------------------------------------------- |
| Tag / chip         | `rounded-sm`                                   |
| Button / input     | `rounded-md`                                   |
| Card / panel       | `rounded-lg`                                   |
| Modal / drawer     | `rounded-xl`                                   |
| Pill               | `rounded-full`                                 |

## Typography

| Role               | Utility                                                       |
| ------------------ | ------------------------------------------------------------- |
| Display heading    | `font-heading text-4xl font-bold tracking-tight md:text-6xl` |
| Page title         | `font-heading text-3xl font-bold md:text-4xl`                 |
| Section heading    | `font-heading text-2xl font-semibold md:text-3xl`             |
| Body               | `text-base leading-6`                                         |
| Body small         | `text-sm leading-5`                                           |
| Mono / ID          | `font-mono text-xs uppercase tracking-widest font-semibold`   |

## Touch Targets

| Role               | Utility                                        |
| ------------------ | ---------------------------------------------- |
| All interactive    | `min-h-11 min-w-11`                            |
| Primary CTA (mobile) | `w-full sm:w-auto`                           |

## Accessibility

| Role               | Utility                                        |
| ------------------ | ---------------------------------------------- |
| Focus ring         | Tailwind's default `focus-visible:ring-2` + `focus-visible:ring-blue-500` |
| Reduced motion     | Wrap custom animation in `motion-safe:animate-*` |
| Screen reader only | `sr-only`                                      |