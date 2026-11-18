set -eu
pg=$(pg_config --bindir)
root=$(mktemp -d /tmp/vis-82-postgres.XXXXXXXX)
trap '"$pg/pg_ctl" -D "$root/data" -m fast stop >/dev/null 2>&1 || true; rm -rf -- "$root"' EXIT
"$pg/initdb" -D "$root/data" -A trust > /dev/null
start() { "$pg/pg_ctl" -D "$root/data" -l "$root/server.log" -o "-k $root -h ''" -w start >/dev/null; }
start
"$pg/createdb" -h "$root" visit_analytics_fixture
db() { "$pg/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$root" -d visit_analytics_fixture "$@"; }
db -f docs/reviews/fixtures/visit-analytics.sql
concurrent="SET search_path TO visit_analytics_fixture; SELECT record_view('site-a','home','en',synthetic_event('2026-01-02T00:00:00Z',5),'2026-01-02T00:00:00Z')"
db -c "$concurrent" > "$root/first" &
first=$!
db -c "$concurrent" > "$root/second" &
second=$!
wait "$first"
wait "$second"
test "$(cat "$root/first" "$root/second" | sort | tr -d '\n')" = ft
"$pg/pg_ctl" -D "$root/data" -m fast -w stop >/dev/null
start
test "$(db -c "SELECT site || ':' || utc_day || ':' || sum(views) FROM visit_analytics_fixture.daily_views GROUP BY site,utc_day ORDER BY site,utc_day")" = "site-a:2026-01-01:1
site-a:2026-01-02:2
site-b:2026-01-01:1"
db <<'SQL'
SET search_path TO visit_analytics_fixture;
DELETE FROM receipts WHERE expires_at <= '2026-01-02T00:05:00Z';
DELETE FROM daily_views WHERE utc_day < '2026-01-02';
DO $$
BEGIN
  IF record_view('site-a','home','en',synthetic_event('2026-01-02T00:00:00Z',5),'2026-01-02T00:05:00Z')
     OR (SELECT count(*) FROM receipts) <> 0
     OR (SELECT sum(views) FROM daily_views WHERE site = 'site-a') IS DISTINCT FROM 2
     OR EXISTS (SELECT FROM daily_views WHERE utc_day < '2026-01-02') THEN
    RAISE EXCEPTION 'Unexpected expiry/replay result';
  END IF;
END;
$$;
SQL
printf '%s\n' 'PASS — allowed dimensions, replay, concurrent duplicate, restart, scope separation, receipt and aggregate expiry'
