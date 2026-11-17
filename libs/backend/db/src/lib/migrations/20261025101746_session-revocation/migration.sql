-- Revoked SIDs remain permanent tombstones: delayed store.set/touch calls must never restore authority.
CREATE FUNCTION auth_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.expire := LEAST(NEW.expire, NEW.created_at + interval '8 hours');
    IF NEW.revoked_at IS NOT NULL THEN
      NEW.sess := '{}'::jsonb;
      NEW.expire := to_timestamp(0);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RETURN OLD;
  END IF;
  IF OLD.expire <= now() OR NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := COALESCE(NEW.revoked_at, now());
    NEW.sess := '{}'::jsonb;
    NEW.expire := to_timestamp(0);
  ELSE
    NEW.expire := LEAST(NEW.expire, OLD.created_at + interval '8 hours');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER auth_session_guard BEFORE INSERT OR UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION auth_session_guard();
