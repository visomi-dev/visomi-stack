# Web foundations

## Shared design contract

`styles.base.css` at the workspace root is the shared Tailwind v4 entry point.
It imports self-hosted Latin fonts: Inter for body text, Manrope for headings,
and JetBrains Mono for technical details. It customizes typography and defines the shared `ui-focus-ring` accessibility utility.
Radii, shadows, spacing and content widths use Tailwind's standard scales.
Surfaces, touch targets and text rhythm are composed with Tailwind classes in
templates; visual component recipes belong to the UI library. The body canvas,
text colors and minimum viewport height belong to Angular's `src/index.html` and
Astro's `src/layouts/base.astro`, expressed with Tailwind utilities.

Use Tailwind's standard zinc surfaces, blue actions and green/red/amber status
colors. Status meanings also need visible labels. Component classes can use
`font-sans`, `font-heading`, `font-mono`, `rounded-lg` and `rounded-xl`.
Keep the standard spacing scale. No Nive palettes, compatibility aliases or
application-specific validation rules are included.

The Angular and Astro style entry points import this base and explicitly scan
their own source files and the shared UI library. Tailwind automatic scanning is disabled at the
shared entry point so unrelated applications and backend code do not influence
bundles. The shared UI source path is explicitly included in both entry points.
Astro Nx commands explicitly disable CLI telemetry. Its development target stays
in the foreground so Nx owns its lifetime. Angular uses the root PostCSS configuration. Astro uses the Tailwind Vite plugin
and disables PostCSS plugin discovery to avoid processing Tailwind twice.
Prettier reads the same stylesheet for custom utility ordering.

Both builds hash the shared stylesheet, theme script and dependency lockfile.
Changes to those files invalidate their Nx build caches.

## Themes and accessibility

`libs/web/frontend/ui/src/theme/theme.base.js` is a shared classic browser script loaded synchronously before
paint. Angular copies it as a public asset; Astro imports it as a non-inlined URL.
The gateway's existing self-only script policy remains intact. Fonts and scripts
are served locally; no external telemetry or font services are enabled.

The script stores `light`, `dark` or `system` in the `visomi.theme` local-storage
key. Missing or invalid preferences follow the system. Explicit preferences win
over system changes. Blocked storage affects persistence only. The script applies
`.dark` to the document root and connects native `[data-theme-select]` controls.
It is guarded against server execution. It does not expose a global API.

Use semantic landmarks, translated labels, visible keyboard focus, adequate
contrast and 44px control targets. Scrolling respects reduced motion; components must apply the same preference
to any animation they introduce. The initial pages are readable without JavaScript. The checks described
below do not constitute a full accessibility conformance audit.

## Routes and runtime boundaries

| Surface | English    | Spanish    | Runtime                                |
| ------- | ---------- | ---------- | -------------------------------------- |
| Website | `/en/`     | `/es/`     | Compiled Astro through Express gateway |
| Webapp  | `/app/en/` | `/app/es/` | Independent Angular SSR server         |
| API     | `/api/`    | Same       | Existing embedded Express API          |

The website root and standalone webapp root redirect to English. Astro messages
live with the site. Angular uses XLIFF, localized build outputs and `withI18nSupport()` for hydration
of translated blocks. Localizing UI
copy does not change the English convention for code, comments and documentation.

The gateway executable imports only compiled API and Astro modules. It validates
the Astro middleware contract and passes the handler and absolute public-asset
directory into its import-safe composition function. `SITE_APP_PATH` overrides
the compiled Astro entry for local execution; its default is the sibling
`../site/server/entry.mjs`. The matching `client` directory is derived from that
entry, independently of the process working directory.

API handling and reserved `/api` and `/app` 404s precede public static assets and
Astro SSR. The gateway owns the listener, security headers, authentication chain,
telemetry and resource shutdown. The shared error handler remains last.

The pinned Astro packages have pnpm patches for the gateway's runtime policy:
middleware errors delegate to Express, importing the site installs no global
rejection handler, and failed stream cancellation never logs URLs or exception
details. The configured site logger emits controlled event codes only. See
[patch maintenance](../patches/README.md); keep these files in dependency installs
and build-cache inputs until replacement versions pass the regressions.

Nx builds `web-site` and `web-api` before the gateway. Preserve all three sibling
output directories, including site chunks and client assets. The existing Docker
build copies `dist/apps/web` into the runtime image; dependencies required there
remain in the root production manifest. No hosting or deployment is configured
by this change. Angular gateway integration is deferred.

## Verification

```sh
pnpm nx run-many -t build,lint,typecheck -p web-site,web-app,web-gateway,web-app-e2e
pnpm nx test web-app
pnpm nx test web-gateway
pnpm nx run-many -t e2e -p web-site,web-app-e2e
```

Angular tests use `vitest-angular` and the workspace's Vitest 5. `@angular/build`
22.2.4 supports Vitest 5; declare/install it before generating the application.
The generator ran with `--skipPackageJson` to preserve Express and Vitest versions.
Native optional Angular cache modules are disabled in pnpm's build-script policy.

Gateway integration tests verify compiled imports, unchanged API behavior,
PostgreSQL-backed authentication and graceful shutdown. Browser suites exercise
both languages, real SSR and Angular hydration, static assets, strict site CSP,
reserved routes, theme choices, blocked storage, reduced motion, keyboard focus,
mobile layout and JavaScript-disabled content. Screenshots stay in local
`dist/.playwright` test output; fixtures contain no customer data.

## Shared component styles

`web-frontend-ui` is a framework-independent TypeScript library generated with
`@nx/js:library`. Import `button` from `@visomi-stack/web-frontend-ui` and call
`button.classes({ variant: 'secondary', size: 'sm' })`. The function composes
complete Tailwind classes, defaulting to `primary` and `md`. It has no framework
runtime dependencies and no independent build artifact.

Angular uses a native `<button appUI>` directive; Astro uses its own
`button.astro` component. Both receive the same typed variants and sizes and
retain native disabled, focus, keyboard and form behavior. Interaction belongs
to each application. Astro evaluates the recipe on the server and needs no
client hydration for the styled button itself. Angular hydrates its native
button normally.

The Angular foundations page includes the sample. The isolated Astro sample is
available at `/en/button/` and `/es/button/`; it includes a small counter script
and a native GET form that works without JavaScript. No Angular Elements runtime
is loaded. See the [library README](../libs/web/frontend/ui/README.md) for usage
and verification commands.

The production gateway sample loads 1,818 bytes of script bodies: 1,470 bytes for
the existing theme script and 348 bytes for the counter. The shared recipe adds
no browser JavaScript to Astro. The Playwright script-payload test records these
resources in `javascript-cost.json`; CSS, fonts and HTTP headers are excluded.
Astro's tsconfig explicitly includes `src/**/*.astro` so Vite can apply the
workspace-generated import paths to those files.

## Component catalog

The website's `/en/ui/` and `/es/ui/` routes document 37 shared recipe families,
with live previews and usage for both frameworks. The homepage links to them.
The [compendium](frontend-ui-catalog.md) records the reference comparison,
selection, behavior contracts and deferred widgets; the
[library README](../libs/web/frontend/ui/README.md) lists typed options.

Angular control and styling adapters use native elements selected with `appUI`
and a static marker where necessary. `app-field` owns field composition and
projects the native control; `p[app-error]` owns the message animation wrapper. Form controls use `uiSize` for visual size, preserving native
numeric `size`. Integration tests cover selector isolation, form values,
attributes, events, visual changes and native modal delegation. The catalog
renders entirely through Astro SSR; only the external theme and small native
demo script run in the browser, within the existing CSP. The tests cover all
families, both languages, JavaScript-disabled controls, dialog focus and Escape,
local validation, reduced motion and mobile/desktop layouts in both themes.

The compiled catalog loads 2,749 bytes of script bodies: the existing 1,470-byte
theme script and a 1,279-byte documentation enhancement. The recipes add no
browser JavaScript. These measurements exclude CSS, fonts and HTTP headers;
the browser test checks that only those two scripts load and caps their combined
raw size at 6 KiB.

Field errors and responsive table options are described in the shared library
README. Their state and layout selectors remain in the component recipes.
The website catalog and Angular sample demonstrate error reveal/collapse,
Signal Forms, `mobileCards` and `stickyHeaders`; the website requires no client
code for error transitions or table layout conversion.

The component/directive choice is documented in the repository working agreement.
Field components own label/description/error markup and stable IDs, while the
consumer owns native control bindings and validation. The shared library README
contains Angular `appField` reference helpers and equivalent Astro markup.

The component catalog also links to full-page shell examples at `/en/ui/shell/`
and `/es/ui/shell/`. These exercise the shared sidebar, application header and
mobile navbar recipes through Express SSR. Angular's foundation page uses the
matching composition, with native routing and hydration. Shell layout needs no
website client script; only the existing appearance preference script is loaded.

## Public website experience

The homepage introduces the stack and its broader product direction. The
original visual samples now live at `/en/foundations/` and `/es/foundations/`.
The localized `/architecture/` and `/docs/` pages explain the runtime boundaries
and local setup. Shared public navigation also wraps the existing component
catalog. See [the website guide](website.md) for page ownership and verification.
