# Browser consent verification

The [Chromium network capture](fixtures/browser-consent/synthetic-network.json)
contains only telemetry paths, methods, allowlisted request payloads and status
codes. The authentication journey uses synthetic accounts and an isolated
PostgreSQL database. The same consent tests passed in Chromium, Firefox and
WebKit. GPC and DNT were simulated through browser signals.

| Scenario                | Browser assertion                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default off and sign-in | Zero telemetry requests before the privacy decision. The anonymous dashboard visit redirects to sign-in.                                                                                     |
| Expected failures       | A handled rejection and an expected HTTP 404 produce no report.                                                                                                                              |
| Manual report           | The selected `RangeError` is accepted with 202. The other pending report stays local and can be discarded. The browser preference stays unset.                                               |
| Accept and navigate     | The next uncaught exception is accepted with 202. The docs page and dashboard visits are accepted with 204. A router transition away from the dashboard and back records only the dashboard. |
| Redaction               | Browser requests omit cookies, referrers and the synthetic markers used as exception messages, queries and fragments. Only fixed fields are in the capture.                                  |
| Reject and reload       | Zero new automatic requests, including after the reload into the Spanish dashboard. A manual send is still accepted with 202.                                                                |
| GPC and DNT             | Each signal independently suppresses automatic requests despite a saved acceptance.                                                                                                          |
| Foreign origin          | The visits receiver returns 403.                                                                                                                                                             |

The journey first passed in Chromium while the visit flag was present. The
capture below comes from the regression with the flag absent. The captures use
desktop and mobile viewport emulation and contain only synthetic information.

- [Astro, 1366 × 900, English, light](fixtures/browser-consent/website-desktop-light-en.png)
- [Angular dashboard, 390 × 844, Spanish, dark](fixtures/browser-consent/app-mobile-dark-es.png)

The browser test compares the Accept and Reject controls' color, background,
border, font size and dimensions. It uses keyboard activation for the desktop
dialog and its purpose link and verifies that Escape restores focus to the opener.
