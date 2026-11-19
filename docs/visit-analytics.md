# Self-hosted visit analytics

VIS-82 supplies the bounded intake and PostgreSQL summary. The website reports
four fixed page categories: home, architecture, docs and UI. Angular reports
foundations and the authenticated home dashboard as `app-foundations` and
`app-dashboard`. It observes completed router navigations. Account, vault,
persistence, authentication and other routes have no visit category. The
dashboard's existing session checks govern access.

## Browser consent

Automatic sharing starts off. The in-flow notice offers equivalent buttons for
the two choices. The public Privacy page explains the choice in English and
Spanish and lets visitors change it. The website and app link to it from their
footers. The
decision is shared across Angular and Astro pages on the same origin. It survives
reload and responds to changes in other tabs. The browser keeps the decision in
local storage and never transmits its local grant value. Unavailable storage
fails closed. Global Privacy Control and Do Not Track take precedence over a
saved acceptance while either signal is active.

A view is an observation of a visible allowlisted page. Repeated lifecycle hooks
for the same page are suppressed. Acceptance itself creates no view. A later
navigation to a different allowlisted page or a reload can add a view. The
observer attempts delivery once, revalidating the same live grant just before
submission. It does not persist events, retry them or backfill visits from
before acceptance or between grants. Assets, APIs, prefetches and admin pages
are excluded. This counts page openings and provides no estimate of unique
visitors. Privacy signals, offline clients, blocking and rate limits can reduce
the counts.

The receiver checks the exact configured origin, honors the GPC and DNT
request headers, bounds all input and uses a global process rate limit. Each
view contains only the allowlisted category and language. The receiver adds
the fixed deployment site key. The browser sends no credentials, referrer,
URL, cookie or person or resource identifier in the visit payload.

## Storage and configuration

The gateway uses the existing PostgreSQL connection and the same canonical
`AUTH_ORIGIN` as its public app. Intake remains unavailable when PostgreSQL
is unconfigured or unreachable. Visit analytics has its own endpoint and
operates independently of the browser-error, browser-performance, private
metrics and server export settings.

The private summary compares the selected 7- or 30-day UTC window, including
today, with the preceding window of the same length. Today is partial. The
summary includes page and language totals and reported dates. Empty, disabled
and storage unavailable have distinct contract states. Consumers should expose
the summary only through their existing authorization boundary with
`private, no-store`.

Daily counters survive restarts and deployments with the same database. The
next accepted view prunes rows older than 90 UTC days for the site. Site keys
allow independent sites to share a database. A site that stops accepting
views retains expired rows until its next accepted view. Backups follow the
database operator's retention policy.

## Release transition and reversal

Before VIS-86, `VISOMI_VISIT_ANALYTICS` gated both the gateway collector and
the Astro entrypoint. It appeared in the example environment, gateway and
Astro runtime, browser fixtures and this contract. It was absent from Railway
configuration and Angular. The gateway used `BROWSER_TELEMETRY_ORIGIN` for
both receivers. Railway set it to the same value as `AUTH_ORIGIN`, and test
fixtures and the Jaeger smoke test set their own gateway origin. Standalone
Angular still uses its independent `BROWSER_TELEMETRY_ORIGIN` for the browser
receiver. VIS-86 also retires the separate browser error and performance toggles.
The browser choice governs both types of automatic capture and delivery.

1. Validate the consent and one-off report flows with the previous flags
   present. Then verify visits, errors and performance with those flags absent,
   including canonical and foreign origins. Verify that an authenticated private
   receiver can get backend traces while automatic browser sharing is off.
2. For a future authorized release, verify that `AUTH_ORIGIN` matches the
   actual public origin and the previously intended browser intake origin.
   Confirm the private OTLP receiver configuration is complete if server export
   is intended. Leave retired variables in provider configuration until a
   separate approved cleanup, and review any future IaC plan for removals.
3. If the receiver change needs reversal, revert the relevant VIS-86 commits
   while retaining the consent implementation. An older executable uses its
   matching toggles and origin settings. Both revisions use the same table and
   aggregation contract, and no database reversal is required.

These are source and verification steps. No provider, DNS, deployment or
production data changes are part of VIS-86.
