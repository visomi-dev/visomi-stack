# Self-hosted visit analytics

VIS-82 supplies a shared browser observer, bounded intake and PostgreSQL
summary. The public stack site reports four stable page names. VIS-83 adds
the portfolio page allowlist and the first private owner report.

A page view is one observation of a visible public page. Repeated lifecycle
hooks for the same current page are suppressed. A navigation to a different
page or a reload can add a view. The observer makes one attempt without
retry. Page views exclude assets, APIs, prefetches and admin pages.
JavaScript-capable bots can still contribute. Privacy signals, offline
clients, blocking and rate limits can reduce counts. This measures page
openings and provides no estimate of unique visitors.

The intake accepts an allowlisted page name and language and adds a fixed,
deployment-configured site key. The observer sends no credentials, referrer,
URL, cookie or identifier. The intake honors Global Privacy Control and Do
Not Track. Origin checking, a small strict input, and a global rate limit
bound the write path without storing any client identifier.

VISOMI_VISIT_ANALYTICS is a separate runtime opt-in and defaults off. The
report compares the selected 7- or 30-day UTC window, including today,
with the preceding window of the same length. Today is partial. The report
includes page and language totals and reported dates. Empty, disabled and
storage unavailable have separate states.

The daily counters survive restarts and deployments with the same PostgreSQL
database. The next accepted view prunes rows older than 90 UTC days for the
site. Site keys allow independent sites to share a database. A site that stops
accepting views retains expired rows until its next accepted view. Backups
follow the database operator's retention policy. The implementation uses no
external provider or additional datastore.

Consumers should expose the summary only through their existing authorization
boundary with private/no-store. Technical metrics and error reports keep
their separate storage and retention.
