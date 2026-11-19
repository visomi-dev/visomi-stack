# Consent, Google loading, and authenticated shell

This follow-up starts at `415711d`. The continuous workspace uses the pre-#34 shell at `cbcc871` as a visual reference and retains the current navigation, dashboard, and mobile drawer.

## Consent confirmation

A fresh grant from the compact notice replaces the choices with the localized thank-you and a 10-second countdown. The progress and changing number are visual. The stable status region announces the thank-you once. The timer is attached to the current grant and stops on revocation, browser privacy signals, or navigation. Dismissal leaves the choice saved. The Privacy settings page still displays the current choice and allows revocation.

| Surface           | Desktop, light, EN                                                                           | Mobile, dark, es-MX                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Astro website     | [1366 × 900](fixtures/consent-auth-shell/consent-confirmation-website-desktop-light-en.webp) | [390 × 844](fixtures/consent-auth-shell/consent-confirmation-website-mobile-dark-es.webp) |
| Angular workspace | [1366 × 900](fixtures/consent-auth-shell/consent-confirmation-app-desktop-light-en.webp)     | [390 × 844](fixtures/consent-auth-shell/consent-confirmation-app-mobile-dark-es.webp)     |

## Google button

The shared button reserves the configured Google control width and its 40 px button height inside the existing 44 px slot. The neutral skeleton is static and noninteractive. It covers provider discovery and SDK rendering. Disabled and failed discovery remove it. SDK errors retain the existing retry action.

| Flow                            | Loading                                                             | Rendered fixture                                                |
| ------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Sign-in, 1280 × 900, light, EN  | [Skeleton](fixtures/consent-auth-shell/google-loading-sign-in.webp) | [Button](fixtures/consent-auth-shell/google-ready-sign-in.webp) |
| Sign-up, 390 × 844, dark, es-MX | [Skeleton](fixtures/consent-auth-shell/google-loading-sign-up.webp) | [Button](fixtures/consent-auth-shell/google-ready-sign-up.webp) |

## Authenticated shell

The shell keeps the header stationary, scrolls the full-width main region, and centers the content inside it. The existing dashboard cards own their own surfaces. The sidebar and drawer place the localized Privacy link beneath the account trigger. The four top-level account actions retain their destinations, and the Security settings disclosure retains its child links and active-route treatment.

- Desktop EN, 1680 × 900, [expanded light](fixtures/consent-auth-shell/shell-desktop-expanded-en.webp), [compact light](fixtures/consent-auth-shell/shell-desktop-compact-en.webp), [expanded account light](fixtures/consent-auth-shell/shell-desktop-expanded-account-light-en.webp), [compact account dark](fixtures/consent-auth-shell/shell-desktop-compact-account-dark-en.webp).
- Mobile es-MX, 390 × 844, [account closed in dark](fixtures/consent-auth-shell/shell-mobile-account-dark-closed-es.webp), [account open in light](fixtures/consent-auth-shell/shell-mobile-account-light-open-es.webp) and [dark](fixtures/consent-auth-shell/shell-mobile-account-dark-open-es.webp).

The captures use a local Chromium fixture with synthetic accounts and dashboard data. The Google script and button are synthetic fixtures. Browser tests control elapsed time for the consent countdown and compare button and neighboring control positions before and after loading. The shell tests measure the scrollbar owner's right edge and verify keyboard reachability, focus return, route links, and document scroll containment across Chromium, Firefox, and WebKit.
