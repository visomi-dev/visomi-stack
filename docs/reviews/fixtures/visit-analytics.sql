-- Isolated PostgreSQL 17 evaluation of the VIS-82 storage candidate.
-- This fixture is not a production migration. The timestamps and routes are synthetic.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'visit_analytics_fixture' THEN
    RAISE EXCEPTION 'Use the disposable visit_analytics_fixture database';
  END IF;
END;
$$;

CREATE SCHEMA visit_analytics_fixture;
SET search_path TO visit_analytics_fixture;

CREATE TABLE pages (
  site text NOT NULL,
  page text NOT NULL,
  locale text NOT NULL,
  PRIMARY KEY (site, page, locale)
);

CREATE TABLE receipts (
  site text NOT NULL,
  event uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site, event)
);

CREATE TABLE daily_views (
  site text NOT NULL,
  page text NOT NULL,
  locale text NOT NULL,
  utc_day date NOT NULL,
  views bigint NOT NULL,
  PRIMARY KEY (site, page, locale, utc_day),
  FOREIGN KEY (site, page, locale) REFERENCES pages
);

INSERT INTO pages VALUES ('site-a', 'home', 'en'), ('site-a', 'pricing', 'es'), ('site-b', 'home', 'en');

-- The caller supplies an allowlisted site and page. now_at is an injectable fixture clock.
CREATE FUNCTION record_view(
  site_key text, page_key text, language text, event_id uuid, now_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SET search_path TO visit_analytics_fixture
AS $$
DECLARE
  issued_ms bigint := ('x' || left(replace(event_id::text, '-', ''), 12))::bit(48)::bigint;
  issued_at timestamptz := to_timestamp(issued_ms / 1000.0);
  accepted boolean;
BEGIN
  IF event_id IS NULL OR now_at IS NULL OR get_byte(uuid_send(event_id), 6) >> 4 <> 7 OR
     get_byte(uuid_send(event_id), 8) >> 6 <> 2 OR
     issued_at > now_at OR issued_at <= now_at - interval '5 minutes' OR
     NOT EXISTS (SELECT FROM pages WHERE (site, page, locale) = (site_key, page_key, language)) THEN
    RETURN false;
  END IF;

  WITH inserted AS (
    INSERT INTO receipts (site, event, expires_at)
    VALUES (site_key, event_id, issued_at + interval '5 minutes')
    ON CONFLICT (site, event) DO NOTHING
    RETURNING 1
  ), counted AS (
    INSERT INTO daily_views (site, page, locale, utc_day, views)
    SELECT site_key, page_key, language, (issued_at AT TIME ZONE 'UTC')::date, 1
    FROM inserted
    ON CONFLICT (site, page, locale, utc_day) DO UPDATE SET views = daily_views.views + 1
    RETURNING 1
  )
  SELECT EXISTS (SELECT FROM counted) INTO accepted;
  RETURN accepted;
END;
$$;

-- Build UUIDv7 test inputs for known dates. Application code already owns canonical UUIDv7.
CREATE FUNCTION synthetic_event(issued_at timestamptz, suffix integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (lpad(to_hex((extract(epoch FROM issued_at) * 1000)::bigint), 12, '0')
    || '70008000' || lpad(to_hex(suffix), 12, '0'))::uuid;
$$;

DO $$
DECLARE
  first_day timestamptz := '2026-01-01T00:00:00Z';
  next_day timestamptz := first_day + interval '1 day';
  event_id uuid := synthetic_event(first_day, 1);
BEGIN
  IF NOT record_view('site-a', 'home', 'en', event_id, first_day)
     OR record_view('site-a', 'pricing', 'es', event_id, first_day)
     OR record_view('site-a', 'private-route', 'en', synthetic_event(first_day, 2), first_day)
     OR NOT record_view('site-b', 'home', 'en', event_id, first_day)
     OR NOT record_view('site-a', 'pricing', 'es', synthetic_event(next_day, 3), next_day)
     OR record_view('site-a', 'home', 'en', synthetic_event(next_day, 4), first_day) THEN
    RAISE EXCEPTION 'Unexpected view intake or idempotency result';
  END IF;
END;
$$;
