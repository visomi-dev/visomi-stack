# Self-hosted visit analytics

VIS-82 supplies the bounded intake and PostgreSQL summary. The website reports
four fixed page categories: home, architecture, docs and UI. Angular reports
foundations and the authenticated home dashboard as `app-foundations` and
`app-dashboard`. It observes completed router navigations. Account, vault,
persistence, authentication and other routes have no visit category. The
dashboard's existing session checks govern access.

## Browser consent

Automatic sharing starts off. The privacy controls in the header allow visitors
to accept or reject sharing and explain the choice in English and Spanish. The
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
Angular still uses its independent `BROWSER_TELEMETRY_ORIGIN` when its
optional error receiver is active.

1. Validate the consent and one-off report flows with the previous visit flag
   present. Then verify the same network behavior with the flag absent,
   including the canonical and foreign origin cases, and check the existing
   server telemetry suite.
2. For a future authorized release, verify that `AUTH_ORIGIN` matches the
   actual public origin and the previously intended browser intake origin.
   Leave the retired variables in provider configuration until a separate
   approved cleanup. The new gateway ignores them.
3. If the collector change needs reversal, revert the VIS-86 commit while
   retaining the consent commit. The older gateway again uses its visit flag
   and origin setting. Match the retained variables to that previous runtime
   during an authorized release. Both revisions use the same table and
   aggregation contract, and no database reversal is required.

These are source and verification steps. No provider, DNS, deployment or
production data changes are part of VIS-86.
