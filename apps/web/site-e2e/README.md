# Landing Visual Checks

Run `pnpm nx run site-e2e:landing` with port 4200 free. This target owns a standalone
`site:serve` process; it does not start the gateway or reuse an existing server.
Chromium must be installed (`pnpm exec playwright install chromium`).

The suite covers English/Spanish and light/dark at 375x812, 768x1024, 1024x768,
1280x720, 1280x800, and 1920x1080. It waits for local fonts, selects the theme before
navigation, reduces motion, and hides the Astro development toolbar. Every case
captures the viewport and entire hero, checks horizontal overflow and hero text
clipping, requires the primary CTA above the fold, and checks desktop hero height.

Artifacts default to ignored `dist/.playwright/landing`. Set `LANDING_OUTPUT_DIR`
to an absolute path to keep separate before/after runs. Open and visually review
the PNGs; passing geometry checks alone is not visual approval.

For optional pixel regression, first review the captured viewport images, then
generate local baselines with:

```sh
LANDING_BASELINE_DIR=/tmp/opencode/landing-baselines pnpm nx run site-e2e:landing --update-snapshots
LANDING_BASELINE_DIR=/tmp/opencode/landing-baselines pnpm nx run site-e2e:landing
```

Open the generated baselines before accepting them. Use the same OS and installed
Playwright/browser version for comparison. Missing baselines fail unless explicitly
updating; omit `LANDING_BASELINE_DIR` for capture plus geometry checks only. Keep
large images outside Git. No auth, API, gateway, or security contracts are changed
or exercised by this site-only suite.
