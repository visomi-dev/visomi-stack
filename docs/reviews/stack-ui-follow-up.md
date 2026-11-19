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

The inset panel keeps the toolbar and footer outside the content scroll area. Workspace can expand and collapse in the desktop sidebar. Compact mode keeps route icons, accessible names, and active styling. The account trigger opens a native popover with identity, Account, Security, an expandable group of existing security destinations, and the separated Sign out action. The mobile drawer has the same account destinations. One brand link leads Home in each visible navigation surface.

The Home example uses fixed synthetic check counts. The 7- and 14-day controls update the summary cards, line chart, text summary, and table together. The visit analytics contract and its private summary have their existing authorization boundary. [Visit analytics](../visit-analytics.md)

- [Expanded sidebar and inset Home](fixtures/stack-ui-follow-up/shell-expanded.webp)
- [Compact icon rail](fixtures/stack-ui-follow-up/shell-compact.webp)
- [Mobile drawer and account group](fixtures/stack-ui-follow-up/shell-mobile.webp)
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

### Separate cross-device requirement

The authorized sync path has usable pieces. `Devices.approve` validates a recipient's fresh challenge against current membership and scope authority, checks the current authorized device's signature and roster epoch, and stores contextual ciphertext. `WebCryptoDevices.accept` and `DeviceCustody.open` verify the recipient delivery against an independently trusted signing pin before decrypting. `SyncReplica` keeps monotonic generation and roster floors. Historical replay can require explicit deliveries of older generation keys. [Authority and synchronization contract](../architecture/contracts/persistence-keys-sync.md)

Today's demo uses the `reference-demo` IndexedDB namespace and a local key. It does not participate in authorized cloud enrollment. For an enrolled resource, `IndexedDbVaultStorage.getKey` and `putKey` select one wrapped key per owner, key scope, and generation. Adding a second wrapper at that key raises a conflict. `VaultSession` also selects and checks a single wrapping context for device and resource custody. The existing PIN fallback only offers a new PIN when passkey unlock is unavailable. The example workspace supports first-device bootstrap, and the complete remote-recipient approval UI is still missing.

A separate implementation can reuse authorized enrollment to deliver the same vault key to a second device, then let that device explicitly enroll and manage independent local passkey and PIN wrappers for the same approved device custody and data keys. It needs a versioned wrapper model that preserves the original binding, encrypted units, encryption budget, and generation/checkpoint pins, along with product approval for adding the weaker PIN method on a passkey-capable device. A locally chosen PIN and its derivation stay on that device.

Security coverage needed for that work includes denial for unapproved recipients, replay and substituted delivery rejection, trusted signing-pin and roster/generation checks, independent PIN and PRF enrollment and offline unlock, canceled and unsupported ceremonies, incorrect PIN and tamper handling, no credential or PIN material in network/storage evidence, interrupted enrollment and migration, historical replay, concurrent changes, device revocation and key rotation, and account-switch/logout/lock behavior. Verify with two authorized browsers and physical PRF-capable devices before claiming device support.
