# Preview Chrome

The preview server wraps each prototype in a small toolbar that lets the engineer switch viewport and toggle dark mode without leaving the page. The iframe loads `/preview/<slug>/frame?theme=light|dark`.

## Toolbar

| Control    | Default             | Effect                                                                |
| ---------- | ------------------- | --------------------------------------------------------------------- |
| Index link | `← Index`           | Returns to `http://localhost:4300/`                                    |
| Viewport   | `Mobile / Tablet / Desktop` | Reloads the page with `?viewport=<preset>`. Default is `desktop`. |
| Theme      | `Light / Dark`      | Toggles the iframe `src` between `?theme=light` and `?theme=dark`.     |

## Viewport Presets

| Preset   | Width  | When to use                                          |
| -------- | ------ | ---------------------------------------------------- |
| Mobile   | 375px  | First visual check after authoring.                  |
| Tablet   | 768px  | Second check; verifies two-column layouts reflow.    |
| Desktop  | 1280px | Third check; verifies the full layout rhythm.        |

The iframe width is set via `[data-viewport="…"]` selectors in `apps/web/ui-designer/src/preview/preview.css`. The stylesheet is built into `dist/apps/web/ui-designer/public/tailwind.css` by the `build-css` target.

## URL Contract

```
GET /preview/:slug                       # preview chrome with iframe
GET /preview/:slug?viewport=mobile       # mobile viewport
GET /preview/:slug/frame?theme=light     # raw prototype, light
GET /preview/:slug/frame?theme=dark      # raw prototype, dark
GET /api/prototypes                      # JSON manifest
GET /healthz                             # { "ok": true }
GET /                                    # index page
```

## Watch + Live Reload

The `serve` target watches `src/**/*` via `@nx/js:node`. When a prototype HTML file or `styles.base.css` changes, the next request gets the updated content. There is no SSE push yet (deferred to a follow-up spec); a manual reload suffices for the current loop.

If the CSS bundle goes stale, run:

```bash
pnpm nx run ui-designer:build-css --skip-nx-cache
```

## Troubleshooting

| Symptom                                            | Fix                                                           |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Prototype shows raw HTML with no styles            | `pnpm nx run ui-designer:build-css --skip-nx-cache`           |
| New utility class not generated                    | Add the file under `src/prototypes/`, re-run `build-css`       |
| Preview iframe is blank                            | Check the dev server console for the load error                |
| `404 Prototype "x" not found`                      | The slug must be kebab-case; the file must end in `.html`      |
| `400 Invalid viewport`                             | Use `mobile`, `tablet`, or `desktop` (lowercase)               |