# Angular component folders

The audit covered `apps/web/app/src/app` on Stack at `6aa9b349dea4aa6f8735d598b3171689068ed394`. It found 54 production component declarations and 14 test fixture components. The fixture components stay in the specs that define them. The root `App` and the `Foundations`, `Home`, and `NotFound` components already have matching folders.

## Moves

Each name below now has a folder under its existing parent. The component and any matching template, style, and spec moved together. Inline templates stayed inline. The 49 previously ungrouped component files account for 109 moved files. `PrivacyLink` was declared in the same file as `ConsentNotice` and now has its own folder because layouts use it independently. Both stay in observability.

| Parent under `apps/web/app/src/app` | New component folders                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| `auth/devices`                      | `request`, `review`                                         |
| `auth/email`                        | `account`, `verify`                                         |
| `auth/google`                       | `google-button`, `manage`, `verify`                         |
| `auth/layouts`                      | `auth-layout`                                               |
| `auth/passkeys`                     | `manage`, `sign-in`, `sign-up`                              |
| `auth/password`                     | `credentials`, `manage`, `reset`, `reset-request`, `verify` |
| `auth/recovery`                     | `enroll`, `request`, `verify`                               |
| `auth/session`                      | `reauthenticate`, `security`, `sessions`                    |
| `auth/shared`                       | `code-entry`, `email-entry`, `feedback`, `resend`           |
| `auth/totp`                         | `backup-codes`, `backup-display`, `manage`, `qr-code`       |
| `db`                                | `example`, `example-vault-devices`                          |
| `i18n`                              | `language-switcher`                                         |
| `layouts`                           | `authenticated-layout`, `not-found-layout`                  |
| `observability`                     | `browser-privacy`, `consent-notice`, `privacy-link`         |
| `shared/vault`                      | `vault-panel`, `vault-unlock`                               |
| `ui/data`                           | `line-chart`                                                |
| `ui/forms`                          | `error-message`, `field`, `pin-input`                       |
| `ui/layout`                         | `app-shell`, `page-loader`, `sidebar`, `topbar`             |
| `ui/theme`                          | `theme-switcher`                                            |
| `vault`                             | `demo`                                                      |

Route imports, the UI barrel, test imports, and file-specific lint rules follow the component paths. The translation catalogs update source-file locations while keeping message IDs and translated text. Existing route-level and service specs keep their coverage and parent folders.

## Folder boundaries for review

- `auth/session` has two coherent responsibilities. `browser-session`, `server-session`, `session`, `navigation`, `interceptor`, and `logout` own session state, enforcement, and lifecycle. `security`, `sessions`, and `reauthenticate` are user-facing security journeys. A future `auth/security` grouping could own those screens while shared session contracts stay in `auth/session`. `methods` is used across sign-in method management and should be placed according to its consumers if that grouping is approved.
- `db` has separate synthetic reference interactions. `example` and `example-workspace` compose the resource workspace. `example-vault-devices`, `example-vault-profile`, and `example-vault-pairing` compose device enrollment for that same reference profile. A future pairing subfolder could group that flow if it grows, with the encrypted resource and its contracts retaining their current ownership.
- `ui/forms`, `auth/shared`, `shared/vault`, and `observability` remain coherent at their current boundaries. Native control directives, shared auth helpers, custody and unlock policy, and telemetry providers stay beside their existing consumers. The component folders give each view an identifiable entry point without adding folders for individual services or directives.
