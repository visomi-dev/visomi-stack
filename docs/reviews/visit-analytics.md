# Self-hosted visit analytics — VIS-82

Review baseline: `6c7cc6104c85f1c2fb5ad405ac073fffcc26772b`. Adoption in
visomi.dev is tracked in VIS-83. The parallel
[implementation in PR #27](https://github.com/visomi-dev/visomi-stack/pull/27)
is the integration under review (inspected at `6a0e34545f9cb65f41b40b302ca0d3e86e4aad23`).
This companion review evaluates a storage tradeoff with a disposable fixture.
It adds no intake, runtime integration or product setting.

## Questions and interpretation

| Question                                | Candidate measure                                                                           | What to show                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Is use of the public site changing?     | Daily observed pageviews, counted from one accepted event per eligible, visible navigation. | Current period total and preceding equal period. Show absolute difference when the previous period is zero. |
| Which published sections get attention? | Sum the same events by server-approved page key.                                            | Counts and share of the selected period.                                                                    |
| Which localized pages are being opened? | Sum by supported page locale.                                                               | Counts for the content's locale, independent of a visitor's browser settings.                               |

Each reload or separately committed navigation can count as a new pageview.
Decide whether a back/forward cache restoration should count as a new pageview. Ignore asset/API calls,
server-render/preload requests, hidden prerenders, canceled transitions and private
routes. A page never observed by a script, disabled collection and blocked
delivery all leave gaps. Script-capable bots may still generate pageviews.
These counts measure observed navigations. Visitor counts, sessions, bounce,
time on page, demographics and geo are outside this slice. The screen should
distinguish zero in an observed period, history unavailable and collection
disabled. Display UTC days with explicit period boundaries and disclose partial
current days.

## Replay-tolerant intake candidate

The implementation in PR #27 sends page and locale, suppresses repeated
observer hooks for the same page, and makes one network attempt. This is a
privacy-minimizing choice with no event identifier. A second valid POST
increments the aggregate again. The fixture below gives different semantics
at the cost of a short-lived per-operation identifier in storage. Add it only
if the approved metric requires idempotent retries or duplicate request
suppression at the intake. It does not limit script-capable bots generating
fresh events.

- The product explicitly selects public pages and canonical page/locale keys.
  For Astro use committed document visibility and back/forward restoration.
  An Angular adapter, where a public route needs one, counts successful visible
  navigation and deduplicates the hydrated initial route.
- The intake is same-origin and bound to configured site/page keys. Use a strict,
  small payload with one random UUIDv7 per navigation operation. The ID exists
  only for intake retry; never reuse it across navigations or store it in
  browser persistence. Reject an expired or future event using the issuance
  time in its ID and the server clock, with a reviewed clock-skew rule. Derive
  the aggregate day on the server. The synthetic fixture uses a five-minute
  retry window and rejects future times to exercise the boundary.
- Persist only site key, page key, locale, UTC day and count in the aggregate.
  Short-lived retry receipts need site key, operation ID and expiry. Avoid raw
  paths, queries, IPs, user agents, email, account IDs, full referrers, consent
  fingerprints and event-level history. The cutoff must also apply to read
  queries while deletion catches up.
- Use server-owned site scope and product authorization on every private query.
  The team or owner-role mapping is a product decision. Keep a bounded date
  range and allowlisted groupings, return private no-store responses, and avoid
  external telemetry export. No queries over client-encrypted domains.
  Collection remains disabled until the product approves its capture, privacy
  and activation policy. Existing performance/diagnostic opt-ins keep their
  current meanings.

## Storage alternatives and current integrations

Astro's telemetry component wires the site observability adapter. The existing
browser intake provides bounded error/performance events and corresponding
controls. Angular's route performance reports timing and outcomes. These
signals have different meanings, lifecycles and consent. Counting HTTP requests
would also include non-navigation traffic. Keep historical analytics outside
those paths and reuse their privacy disciplines for the new intake.

Existing PostgreSQL is a candidate for products that already own a private
database. The repository's database lifecycle and transactions support atomic
retry receipt and aggregate update, and durability across application restarts.
It adds bounded writes and maintenance to that store. An independent self-hosted
analytics service keeps its workload separate, at the cost of an additional
runtime, access surface and retention/export review. In-memory counters lose
history on restart. No dependency, production database or
third-party collector is selected by this proposal.

## Acceptance for the integration under review

PR #27 supplies a default-off observer and intake, 7- and 30-day UTC query
windows, and an aggregate contract for an authorized consumer. Its 90-day
prototype retention runs on intake, so a dormant site can retain rows.
The query period already bounds read results independently. Review an
operational purge policy only if the product promises a deletion deadline
for sites that stop collecting.

Use browser journeys to verify hydration or repeated hooks, fresh navigation,
back/forward and visibility, opt-out and absence of collection when disabled.
Check the request's field allowlist and persistence after restart. Confirm
the decision on accepting duplicate valid requests or using the receipt
candidate. The deployment's observed test and CI claims belong to its own
head. VIS-83 needs to verify the private query and dashboard with its actual
site and authorization roles. Before activation, confirm the allowed data,
product retention and notice/consent treatment.

## Executed fixture

Run from the repository root with local PostgreSQL tools:

```sh
bash docs/reviews/fixtures/verify-visit-analytics.sh
```

The fixture uses a disposable Unix-socket-only cluster and synthetic dates,
routes and event IDs. It observed one count for two concurrent deliveries of
the same event, no count for a changed-page retry of that event, rejection for
unknown pages and future events, independent totals for two sites, unchanged
history across a PostgreSQL stop/start, and refusal of an expired replay after
deleting its receipt. The first period for site A has one view and the next has
two. Site B has one view in the first period. Expiring the first day preserves
site A's later total of two. This checks persistence and aggregation mechanics.
This fixture does not exercise PR #27's browser intake, private product
authorization, dashboard or a production retention schedule.
