# Public website

The Astro website introduces Visomi Stack as a modular foundation for developers
and teams. It explains the product direction and provides a practical local
starting point. Nive and archived visomi-stack-v0 remain read-only references.

## Pages and ownership

Every public page has English and Spanish routes:

| Route after `/en/` or `/es/` | Purpose                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `/`                          | Product introduction, real UI examples, architecture overview, setup and FAQ |
| `architecture/`              | Current runtime boundaries and the intended platform direction               |
| `docs/`                      | Pinned prerequisites, local commands, workspace map and next steps           |
| `foundations/`               | The original typography, color and surface samples                           |
| `ui/`                        | The complete component catalog and framework usage                           |
| `ui/shell/`                  | A standalone application-shell example                                       |

`src/layouts/site.astro` owns public navigation, skip navigation, one main
landmark and the footer. It composes the import-safe base document. Marketing
parts live in `src/components/site/`; existing native UI adapters and shared
recipes are reused. Text/navigation links use the shared `Link` adapter with
explicit color and underline variants; their layout stays at the call site. The standalone application-shell and button experiments keep
their focused demo layouts.

Public content lives in `src/content/en.ts` and `es.ts`. `site.ts` owns the typed
page identifiers and localized paths, so changing language retains the current
public page. The mobile menu uses native `details`, and FAQs use the existing
native disclosure adapter. No client router or extra UI runtime is required.

## Visual and content direction

The design retains zinc/blue, local Inter/Manrope/JetBrains Mono fonts and the
shared focus treatment. Strong type, readable spacing, a source-native product
preview and a runtime map make the structure concrete. The preview is labelled
as an example and links to the real shell catalog. No usage metrics, testimonials
or unsupported production security claims are invented.

As agreed, the website also illustrates the broader direction: worker execution,
realtime delivery and client-protected content. The architecture page identifies
these as future capabilities and distinguishes them from the current gateway,
Astro site, independent Angular SSR application and identity backend.

The homepage, architecture and getting-started pages load only the existing
prepaint theme script. The component catalog additionally retains its small
native demo script. Scripts remain external for Express CSP compatibility.
Metadata contains localized descriptions and Open Graph text. A canonical
production origin and social preview image are not invented before deployment
configuration is decided.

## Development and checks

```sh
pnpm nx serve web-site
pnpm nx run-many -t build lint typecheck e2e -p web-site
```

The website dev server listens on `127.0.0.1:4200`; production browser checks use
the compiled Astro middleware through Express. The setup guide's Spanish Angular
command selects the existing `development-es` configuration explicitly.

Browser coverage checks SSR HTML, locale navigation, no-JavaScript menu/FAQ
interaction, working internal destinations, theme persistence, native samples,
contrast in the colored panel, reduced motion and layouts from 320px to 1440px.
Screenshots use synthetic content and stay in local Playwright output. These
checks are not a complete screen-reader or WCAG certification.

Framework references: [Astro layouts](https://docs.astro.build/en/basics/layouts/)
and [localized routing](https://docs.astro.build/en/guides/internationalization/).
