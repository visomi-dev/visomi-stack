# Google sign-in presentation options (VIS-28)

Reviewed on 2026-11-11. This is a comparison for the owner's decision, not authorization or an implementation of a migration.

## Recommendation

Keep Google Identity Services (GIS) and use its supported rendering options if a 40px visible Google button in a 44px layout row is acceptable. It can match the primary button's width, locale and light/dark context. Exact matching of the existing primary button's 44px visible height, font and corner radius requires a different tradeoff. A CSS override cannot make the cross-origin Google button equivalent to an application-owned button.

If exact visual dimensions and a Visomi loader inside the Google button are essential, choose the server authorization-code OIDC alternative explicitly. GIS already returns OpenID Connect ID tokens; the choice concerns the browser SDK versus a server redirect flow, not adopting OIDC for the first time.

## Current repository

The application uses Angular 22.2, Express 5, Node 24, Passport 0.7, PostgreSQL sessions and google-auth-library 11.3.1. Passport already serializes the local principal. The browser obtains a nonce-bound flow from `/google/start`, renders GIS, and posts its ID token to `/google/complete`.

The existing service verifies the token signature and audience through google-auth-library, then issuer, nonce, subject, verified email and expiry. It handles login/link/reauth, revoked identities and additional email verification for non-authoritative addresses. Full/fresh-session checks, authentication versions, identity locks and session regeneration must survive any transition. The existing session cookie is HttpOnly, Secure in production and SameSite=Strict.

## Supported GIS presentation

Google documents width up to 400px, discrete sizes, shape, theme, logo alignment, text and locale. There is no arbitrary height or internal CSS option. The prototype uses `standard`, `large`, `rectangular`, `outline`/`filled_black`, `continue_with`, explicit `en`/`es`, and a width derived from the available container, capped at 400. A future implementation should respond to container/theme changes and clean up observers with the component lifetime, without resetting an in-flight transaction.

Container CSS can set spacing and alignment. It cannot style the cross-origin iframe's document: stronger selectors and `!important` do not cross that boundary. Overlays, synthetic clicks, scaling, hidden substitute controls and clipped iframes are unsuitable. Branding guidance permits compliant custom HTML artwork, but that does not expose a custom-button trigger for GIS `renderButton`. One Tap `prompt()` is a separate interaction.

Sources: [GIS rendering API](https://developers.google.com/identity/gsi/web/reference/js-reference#GsiButtonConfiguration), [Google branding](https://developers.google.com/identity/branding-guidelines), [browser origin isolation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).

## Isolated browser evidence

A fresh signed-out Chromium context rendered the actual Google SDK under the authorized production origin using a browser-intercepted synthetic page. Nothing was published to the origin; no login, account consent, token completion, account creation or Google Cloud configuration change was performed. The public provider configuration was held in memory; no client ID, tokens or cookies are in the artifacts.

Twelve combinations covered English/Spanish, light/dark and 320/390/1280px viewports. All fit horizontally. The primary button measured 44px high. Google's visible interactive element measured 40px high, although its iframe measured 44px. Visible widths matched at 232/302/400px. The iframe itself was 20px wider because of SDK spacing; constraining the iframe with `max-width:100%` clipped/misaligned its content, so that experiment was discarded. A 44px container does not turn the 40px inner control into a 44px target.

The parent document could not read the iframe document (SecurityError); browser automation measured the inner button through its own frame context. Reviewed synthetic screenshots and measurements are under `dist/.playwright/google-review/`. These are visual rendering checks, not a real Google sign-in or an accessibility certification. Personalized button rendering and real iOS/browser-account combinations remain untested.

## Comparison

| Concern               | Supported GIS                                                                       | Server OIDC with an owned button                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Visual control        | Width up to 400; provider-owned sizes, typography, shape and colors                 | Own dimensions, responsive layout and busy indicator, within Google's branding rules                          |
| Accessibility         | Provider-owned inner control; app owns surrounding labels, focus and error feedback | App owns semantics, focus, accessible names, busy state and regression coverage                               |
| Browser compatibility | Existing integration; SDK/popup/FedCM behavior remains provider-dependent           | Redirect flow; callback/cookie correlation must be tested in Chromium, Firefox and WebKit                     |
| Maintenance           | Small presentation change; existing authentication protocol and configuration       | New transaction lifecycle, callback, dependencies, cancellation and replay handling                           |
| Effort                | Lower; responsive and theme-aware rendering plus focused tests                      | Higher; preserve all existing account/security behaviors, add protocol and cross-site tests                   |
| Infrastructure        | Existing client ID and authorized JS origin; no new server secret                   | Client secret, exact authorized callback URIs, secure configuration and IaC preservation                      |
| Main risk             | Treating iframe dimensions as the visible control; unsupported CSS tricks           | Account linking mistakes, replay, open redirects, cross-site session confusion and multi-tab transaction loss |

## OIDC/Passport candidate assessment

Google's [server-flow documentation](https://developers.google.com/identity/openid-connect/openid-connect#server-flow) describes code exchange on the server, redirect registration and ID-token validation. Keep scopes to `openid email`; request `profile` only for a demonstrated requirement. A client secret belongs only in the server secret manager.

`passport-google-oidc` is published from [passport-google-openidconnect](https://github.com/jaredhanson/passport-google-openidconnect). Its small [Google strategy](https://github.com/jaredhanson/passport-google-openidconnect/blob/master/lib/strategy.js) delegates to passport-openidconnect. The inspected [base strategy](https://github.com/jaredhanson/passport-openidconnect/blob/master/lib/strategy.js) has no PKCE authorization/challenge exchange and parses ID-token claims while explicitly leaving signature-related checks outside that code path. It cannot be assumed to satisfy this issue's S256 and signature-verification requirements without additional work. This is a source assessment, not a general claim that the package is unsafe in every deployment.

If a migration is chosen, `openid-client` 6.x is the stronger candidate to evaluate and pin. Its [runtime documentation](https://github.com/panva/openid-client#supported-runtimes) includes Node with a Node 20 baseline and an ESM package, compatible in principle with Node 24. Its [Passport strategy](https://github.com/panva/openid-client/blob/main/src/passport.ts) creates S256 PKCE and delegates callback checks to the client. This repository has not installed or integration-tested it. Express 5/session compatibility must be verified in the actual application before selection is final.

The inspected strategy does not automatically require both state and nonce in every code flow, and stores a transaction under a session key. Configure/enforce random state, nonce and PKCE explicitly, use short-lived single-use browser-bound transactions for each intent, and support concurrent tabs. Do not assume the default strategy's session storage meets those requirements.

SameSite=Strict prevents relying on the current session cookie on Google's cross-site return. Evaluate a separate short-lived Secure/HttpOnly callback correlation cookie with SameSite=Lax and server-held transactions, followed by same-site completion that revalidates the original session, intent, account and authentication version. Keep the main cookie and all existing CSRF protections unchanged. This design needs replay, cookie and concurrent-tab tests; a plain state string is insufficient.

Before implementation, settle variable names and callback routes, register redirects, test state/nonce/S256 and all ID-token claims, preserve login/link/reauth/unlink and extra email verification, and prepare rollback. Retain existing identities and sessions; remove GIS/CSP permissions only after verifying no consumers remain. The current Google client ID and SMTP configuration must be preserved.

## Owner decision and implementation

The owner selected supported GIS styling and accepted the 40px visible-height difference in this conversation. Implementation retains the existing authentication flow, client ID and session guarantees. The adapter now passes an explicit locale and rectangular shape, uses outline/filled_black according to the app theme, and follows the container width up to 400px through a scoped ResizeObserver. A named Angular render effect updates presentation without another initialization or nonce request; consumed/cancelled attempts are not redrawn. Focused controls defer presentation changes until focus leaves. The observer disconnects on replacement, session cancellation and destruction.

Provider credential processing has an accessible busy state and one parent status announcement without a second standalone spinner below the form. Native retry actions use the shared button loader. The provider-owned control remains a documented exception to a custom Visomi glyph inside every button: no overlay or simulated trigger was added. No OIDC dependencies, callback routes, cookies, client secrets or Google Cloud settings were changed. Deployment and a real authorized Google sign-in remain separate validation gates under VIS-17.

## Production presentation follow-up (2026-11-12)

The owner confirmed that real Google login succeeded, but reported a narrow Spanish Google button on the English page. This confirms login for that attempt, not the remaining account-continuity scenarios in VIS-17.

The deployed document's `no-referrer` policy caused Google's button iframe to return HTTP 400 with an origin-validation error. Its inline fallback remained usable for login but did not honor the requested width. The isolated prototype had no such header, so its earlier measurements did not catch this integration failure. Google-enabled application responses now use `strict-origin`: Google receives the origin for validation, without any document path or query. Other responses retain `no-referrer`; CSP nonces, script-attribute restrictions and the existing Google resource allowlist remain intact. See [Google's setup guidance](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and the [referrer-policy semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

The loader now specifies `gsi/client?hl=en` or `?hl=es` in addition to the render option, as required by the [button display guide](https://developers.google.com/identity/gsi/web/guides/display-button). The official `continue_with` label fits the narrow Spanish layout; `signin_with` can exceed its 215px available width. The application-owned target uses grid centering to avoid flex shrinking the SDK's extra frame space, and a light CSS color scheme to preserve the iframe's transparent canvas in the dark application theme. Google still owns the visible light/dark button colors and its 40px height.

The built application and gateway were checked with the genuine SDK under the authorized HTTPS origin, with synthetic authentication responses and no account selection or credential submission. English/Spanish pages used opposite browser-language preferences. Both themes at 320/390/1280px produced visible widths of 215/285/382px, matching the primary button, with the expected translated Google text. Local evidence is under `dist/.playwright/language-fix/`; it is not a production deployment or a repeat of the owner's real login.
