# Visomi brand assets

The original SVGs in this directory were supplied and approved by the owner
for VIS-15. They are the shared source of truth; keep their paths, proportions and
outlined lettering intact. No font download is required to render the wordmark.

| Asset                | Use                                                                |
| -------------------- | ------------------------------------------------------------------ |
| `isotype.svg`        | Compact headers, previews and workspace avatars                    |
| `logotype-stack.svg` | Stack-specific horizontal mark used throughout this product        |
| `logotype.svg`       | General Visomi horizontal mark, retained as a reusable resource    |
| `wordmark.svg`       | General Visomi outlined lettering, retained as a reusable resource |
| `favicon.svg`        | Browser icon on light browser chrome                               |
| `favicon-dark.svg`   | White derivative of the supplied favicon for dark browser chrome   |

The UI displays the original black assets on light surfaces and inverts the image
on dark surfaces. Favicon links use the browser color-scheme preference to select
the black or white SVG, including without JavaScript.

Astro imports SVG URLs from this directory, letting its existing build emit the
files. Angular's existing asset configuration copies these SVGs to each localized
build's `brand/` directory. Relative Angular URLs resolve through the localized
base href, including nested routes. Nx tracks this directory for both frontend
projects, and Railway watches it for deployment changes. Do not maintain separate
application copies or reintroduce the removed template favicons.

The integration covers the public site's header/footer and error pages, the
Astro shell previews, Angular authentication and error layouts, authenticated
navigation and the foundations shell. Textual product names, page titles and
technical references to Nx remain ordinary content.
