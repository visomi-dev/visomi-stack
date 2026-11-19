# Visomi Stack UI review follow-up

The before captures use main at `cbcc8717e91f7706fe741a6fc48012623e9aa658`. Each browser fixture uses an isolated local gateway and synthetic data. The mobile and shorter keyboard viewport captures use emulation.

## VIS-84 Browser privacy

On desktop the compact card sits at the lower left, above the app’s account trigger and footer when present. It gives way while a separate control has visible keyboard focus and returns when its own controls receive focus. On narrow, short, and touch viewports it appears after the page content in the normal scroll order with safe-area spacing. Both buttons use Stack's secondary treatment and equal dimensions. A dedicated link below the buttons opens the localized public purpose and settings page, which also remains available from Privacy.

| Surface           | Desktop, EN, light, before → after                                | Mobile, es-MX, dark, before → after → card in view               |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Website           | [Overview](fixtures/stack-ui-follow-up/website-desktop.webp)      | [Overview](fixtures/stack-ui-follow-up/website-mobile.webp)      |
| Authenticated app | [Home](fixtures/stack-ui-follow-up/app-desktop.webp)              | [Home](fixtures/stack-ui-follow-up/app-mobile.webp)              |
| Sign-in           | [Password form](fixtures/stack-ui-follow-up/sign-in-desktop.webp) | [Password form](fixtures/stack-ui-follow-up/sign-in-mobile.webp) |

[Focused password field at an emulated 280 × 360](fixtures/stack-ui-follow-up/sign-in-narrow.webp) · [Visual reference](https://playground.cookieconsent.orestbida.com/)

Astro and Angular share the existing origin-local browser decision. Tests accept from each surface while both tabs are already open, reject from the other tab, cross the website/app boundary without another prompt, and reload after revocation. The website-to-app journey reproduced stale status text in an already-open Angular notice. The Angular notice now reads the effective choice on the same storage notification as the reporter. The production report of a second prompt remains unverified.

The network records include the approved endpoint paths, body fields, and response codes. Pending errors stay local until explicitly reported. Both directions delivered new opted-in errors and performance measurements. After revocation the sole telemetry delivery was the one explicitly selected manual report, accepted with 202. Separate browser-signal cases exercise GPC and DNT with a saved grant. Preferences remain scoped to the browser profile and origin.

- [Website choice → app](fixtures/stack-ui-follow-up/consent-from-website.json)
- [App choice → website](fixtures/stack-ui-follow-up/consent-from-app.json)

## VIS-35 Six-digit account and new-device checks

The account-email and new-device email-code forms submit when the native six-digit input becomes complete. Typing, formatted paste, and synthetic autofill replacement use the same input. The length remains in the accessible description. A visible live status accompanies verification, and the existing error alert receives focus on failure. A new entry is required for another request. The password challenge keeps its Start again destination as a text link. Authenticator and backup codes, recovery, confirmation flows, and vault PINs keep their existing submission behavior. The browser coverage simulates the autofill event that populates the native field. System autofill on a physical device remains unverified. [Browser form reference](https://web.dev/articles/sms-otp-form)

[Mobile account-code status, es-MX](fixtures/stack-ui-follow-up/otp-mobile.webp) · [Desktop new-device status, EN](fixtures/stack-ui-follow-up/otp-desktop.webp)

## VIS-30 Authenticated shell and VIS-92 example dashboard

The inset panel keeps the toolbar and footer outside the content scroll area. Workspace can expand and collapse in the desktop sidebar. Compact mode keeps route icons, accessible names, and active styling. The account trigger opens a native popover with identity, Account, Security, an expandable group of existing security destinations, and the separated Sign out action. The mobile drawer has the same account destinations. Its account disclosure opts into a subtle Stack surface without a perimeter border or shadow. The native summary still toggles by keyboard and keeps its focus-visible outline. The desktop account trigger uses its raised floating popover. One brand link leads Home in each visible navigation surface.

The Home example uses fixed synthetic check counts. The 7- and 14-day controls update the summary cards, line chart, text summary, and table together. The visit analytics contract and its private summary have their existing authorization boundary. [Visit analytics](../visit-analytics.md)

- [Expanded sidebar and inset Home](fixtures/stack-ui-follow-up/shell-expanded.webp)
- [Compact icon rail](fixtures/stack-ui-follow-up/shell-compact.webp)
- [Mobile drawer, closed and open in light and dark at 390 px, es-MX](fixtures/stack-ui-follow-up/shell-mobile.webp)
- [Desktop example dashboard](fixtures/stack-ui-follow-up/dashboard-desktop.webp)
- [Mobile example dashboard](fixtures/stack-ui-follow-up/dashboard-mobile.webp)

Composition follows [sidebar-08](https://ui.shadcn.com/view/new-york-v4/sidebar-08). Interaction references were [sidebar-07](https://ui.shadcn.com/view/new-york-v4/sidebar-07), [sidebar-05 and sidebar-06](https://ui.shadcn.com/blocks/sidebar#sidebar-05), and [dashboard-01](https://ui.shadcn.com/view/new-york-v4/dashboard-01). The available `.legacy/nive-archive-v6` sources included `apps/web/app/src/app/shared/layout/layout.html`, `apps/web/app/src/app/shared/layout/sidebar-menu/sidebar-menu.html`, and `apps/web/app/src/app/shared/layout/sidebar-menu/sidebar-menu.ts`. The same sidebar menu paths were present under `.legacy/visomi-stack-v0`. They provided a reference for the compact-width transition, preserved labels, and separate mobile drawer interaction.

### Stack design-system mapping

[VIS-92](https://linear.app/visomi/issue/VIS-92) uses shadcn’s dashboard hierarchy as a composition reference. The visual recipes come from Stack.

| Area               | Shared path                                                                                                                                                                                                                                                                                                                                      | Local composition                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Summary and status | `Card` supplies surfaces. `Badge` supplies the existing success and neutral tones. `Heading`, `Text`, and `Table` cover the surrounding content and daily totals. Compact tables tighten cell spacing on narrow screens.                                                                                                                         | Home owns the grid, numeric hierarchy, synthetic values, headings, and table columns.                                                    |
| Range controls     | The existing secondary `Button` recipe styles native `aria-pressed` in both themes and keeps the shared focus ring and target size.                                                                                                                                                                                                              | Home owns the labels, selected period, and updates to its cards, summary, series, and table.                                             |
| Chart              | The framework-independent `lineChart` recipe owns plot bounds, grid, scale, and light/dark strokes. The Angular `LineChart` composes the existing subtle `Card` and muted `Text` for the date ticks.                                                                                                                                             | The caller supplies numeric values, tick labels, and IDs for the accessible name and summary. Home supplies the accompanying data table. |
| Shell              | `AppShell`, `Sidebar`, `Topbar`, and `NavItem` own the inset panel, compact sizing, reduced motion, focus, and visually hidden compact labels. The real route links use the existing `aria-current` styling. `Avatar`, `Button`, `Card`, and the existing `Disclosure` and `Dialog` primitives handle account presentation and mobile dismissal. | The authenticated layout owns route groups, profile actions, icons, and native submenu and popover placement.                            |

The chart and shell screenshots exercise the shared recipes in light and dark themes. Browser checks cover keyboard focus, pressed range controls, the changing series and accessible summary, table rows, compact labels, and native menu dismissal.

## VIS-87 Vault example and second-device enrollment

The example centers the controls in a constrained card. The six equal cells fill the card's content width. A fixed synthetic note and the PIN setup stay in the local browser's isolated example database. New setup uses the example's explicit PIN action. The unavailable-passkey wording appears only on a negative capability result. Stored bindings keep their own method, and cancellation retains its existing message and behavior.

- [Desktop setup, EN](fixtures/stack-ui-follow-up/vault-desktop.webp)
- [Mobile unlock, es-MX](fixtures/stack-ui-follow-up/vault-mobile.webp)

### Same encrypted scope and independent device unlock

[VIS-87](https://linear.app/visomi/issue/VIS-87) in
[PR #34](https://github.com/visomi-dev/visomi-stack/pull/34) calls for access to
one encrypted scope from two explicitly paired devices. Each device uses its
own enrolled method. A valid vault PRF ceremony uses the credential's actual PRF
result and current vault binding. A client or credential with confirmed lack of
PRF support can offer explicit local PIN setup for new custody. An existing
PIN binding remains usable when capabilities change. Cancellation and ceremony
errors keep PIN setup closed. The account login ceremony and the vault ceremony
remain distinct. [WebAuthn PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension) ·
[VIS-79 PIN contract](../architecture/contracts/offline-pin.md)

The vault now distinguishes cancellation and unexpected WebAuthn errors from
confirmed unavailability. PRF unlock checks the credential, challenge, origin,
RP ID and verification flags before classifying an absent PRF result. A malformed
output fails closed. This uses the existing local wrappers, keys, and account
authorization. The existing `DeviceCustody.open` and `WebCryptoDevices.accept`
still require an independently verified signing pin and the current signed
delivery. [Authority and synchronization contract](../architecture/contracts/persistence-keys-sync.md)

#### Synthetic verification

The [browser integration](../../apps/web/api/tests/integration/vault-browser.integration.spec.ts)
uses independently authenticated Chromium contexts with separate IndexedDB and
virtual authenticators. It exercises PRF on desktop- and mobile-sized profiles and
confirmed unsupported PRF on both viewport sizes. The PRF profiles abort one
creation attempt and then retry PRF. The PIN profile writes a record before
approval. After pairing, the PRF profile opens and edits that same record and the
PIN profile reads the update. Each profile closes custody and reopens it with its
own method. A wrong PIN keeps the vault locked. The PRF profile has no local PIN
provider. The existing cross-account case still covers a stale write,
encrypted outbox, and SQL restore rollback.

The test runner conveys independently computed fingerprints between the profiles.
A wrong recipient fingerprint leaves the delivery absent. A wrong approver
fingerprint prevents local key installation. The recipient checks the matching
signer and signed witness and sets the replica's minimum roster epoch from that
approval. The suite also checks scope authority, generation and roster floors,
historical replay, rotation, retention and ciphertext-only storage. Virtual
authenticators and viewport variation exercise the protocol. Physical iPhone
PRF and an app-rendered pairing flow remain unverified.

The uncached Nx run passed 77 vault library tests, 357 API tests at the
configured 100% coverage, 227 Angular tests, and 16 shared UI tests. The
22 targeted Playwright cases passed across the configured Chromium, Firefox,
and WebKit projects. They included both email OTP flows, Chromium's virtual
account passkey, local PIN reopen, the isolated Vault example, and the mobile
account disclosure. The disclosure checks covered opening, closing, full
drawer width, keyboard focus, both themes, and the desktop popover's raised
surface.

#### Remaining Security integration

The default gateway and standalone API have no product policy that mounts an
encrypted-sync scope. Both obtain persistence solely from the existing opt-in
development or test example selector. The only concrete synchronized
`private-resources` manifest is the synthetic fixture. Its app route requires
that exact manifest and the profile selector rejects production use. The
production-capable Vault example has its own isolated browser-local database.
[Gateway composition](../../apps/web/gateway/src/main.ts) ·
[Standalone API composition](../../apps/web/api/src/main.ts) ·
[API mounting](../../apps/web/api/src/app.ts) ·
[Profile guard](../../libs/shared/db/src/lib/example.ts) ·
[Product persistence contract](../persistence.md)

The approved app surface is authenticated Security. A Vault device action there
needs an explicit, supported encrypted-sync product scope for which the current
device already has custody and approval authority. This checkout has no such
scope to attach it to. The fixture establishes the mixed-capability flow with
the existing persistence composition. The account/Sessions approval continues to
grant restricted account enrollment. [Account approval contract](../../apps/web/api/src/auth/devices/contract.ts) ·
[VIS-69 custody](https://linear.app/visomi/issue/VIS-69) ·
[VIS-70 lifecycle](https://linear.app/visomi/issue/VIS-70) ·
[VIS-72 product composition](https://linear.app/visomi/issue/VIS-72)
