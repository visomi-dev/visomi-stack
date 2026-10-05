CREATE TABLE "push_subscriptions" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "session_binding" text NOT NULL,
  "auth_version" integer NOT NULL,
  "endpoint_hash" text NOT NULL,
  "subscription" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_version_check" CHECK ("auth_version" > 0 AND "revision" > 0),
  CONSTRAINT "push_subscriptions_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_owner_session_idx" ON "push_subscriptions" ("account_id", "user_id", "session_binding");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_session_idx" ON "push_subscriptions" ("session_id");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_expiry_idx" ON "push_subscriptions" ("expires_at");
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "push_subscriptions_owner_policy" ON "push_subscriptions"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
--> statement-breakpoint
-- Revocation cleanup is atomic with PostgreSQL session tombstones/deletion and auth-version changes.
-- These infrastructure triggers must run as the trusted migration owner, not an application RLS role.
CREATE FUNCTION "remove_revoked_session_push"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.push_subscriptions WHERE session_id = OLD.sid;
    RETURN OLD;
  END IF;
  IF NEW.revoked_at IS NOT NULL OR NEW.sess IS DISTINCT FROM OLD.sess THEN
    DELETE FROM public.push_subscriptions WHERE session_id = NEW.sid AND (
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
CREATE TRIGGER "push_session_revocation_cleanup" AFTER UPDATE OR DELETE ON "user_sessions"
  FOR EACH ROW EXECUTE FUNCTION "remove_revoked_session_push"();
--> statement-breakpoint
CREATE FUNCTION "remove_stale_user_push"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.auth_version IS DISTINCT FROM OLD.auth_version THEN
    DELETE FROM public.push_subscriptions WHERE user_id = NEW.id AND auth_version <> NEW.auth_version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "push_auth_version_cleanup" AFTER UPDATE OF "auth_version" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "remove_stale_user_push"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "remove_revoked_session_push"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "remove_stale_user_push"() FROM PUBLIC;
