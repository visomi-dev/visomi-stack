CREATE FUNCTION "remove_revoked_session_vault_custody"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  session_hash_value text;
BEGIN
  session_hash_value := encode(sha256(convert_to(OLD.sid, 'UTF8')), 'hex');
  IF TG_OP = 'DELETE' THEN
    UPDATE public.vault_browser_enrollments SET envelope = NULL, revoked_at = COALESCE(revoked_at, now())
      WHERE session_hash = session_hash_value;
    DELETE FROM public.vault_unlock_assertions WHERE session_hash = session_hash_value;
    RETURN OLD;
  END IF;
  IF NEW.revoked_at IS NOT NULL OR NEW.sess IS DISTINCT FROM OLD.sess THEN
    UPDATE public.vault_browser_enrollments SET envelope = NULL, revoked_at = COALESCE(revoked_at, now())
      WHERE session_hash = session_hash_value AND (
        NEW.revoked_at IS NOT NULL OR NEW.sess->>'authority' IS DISTINCT FROM 'full' OR
        NEW.sess->'passport'->'user'->>'id' IS DISTINCT FROM user_id OR
        NEW.sess->'passport'->'user'->>'accountId' IS DISTINCT FROM account_id OR
        NEW.sess->'passport'->'user'->>'authVersion' IS DISTINCT FROM auth_version::text
      );
    DELETE FROM public.vault_unlock_assertions WHERE session_hash = session_hash_value AND (
      NEW.revoked_at IS NOT NULL OR NEW.sess->>'authority' IS DISTINCT FROM 'full' OR
      NEW.sess->'passport'->'user'->>'id' IS DISTINCT FROM user_id OR
      NEW.sess->'passport'->'user'->>'accountId' IS DISTINCT FROM account_id OR
      NEW.sess->'passport'->'user'->>'authVersion' IS DISTINCT FROM auth_version::text
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "vault_session_revocation_cleanup" AFTER UPDATE OR DELETE ON "user_sessions"
  FOR EACH ROW EXECUTE FUNCTION "remove_revoked_session_vault_custody"();
--> statement-breakpoint
CREATE FUNCTION "remove_stale_user_vault_custody"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.auth_version IS DISTINCT FROM OLD.auth_version THEN
    UPDATE public.vault_browser_enrollments SET envelope = NULL, revoked_at = COALESCE(revoked_at, now())
      WHERE user_id = NEW.id AND auth_version <> NEW.auth_version;
    DELETE FROM public.vault_unlock_assertions WHERE user_id = NEW.id AND auth_version <> NEW.auth_version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "vault_auth_version_cleanup" AFTER UPDATE OF "auth_version" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "remove_stale_user_vault_custody"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "remove_revoked_session_vault_custody"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "remove_stale_user_vault_custody"() FROM PUBLIC;
