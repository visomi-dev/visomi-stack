CREATE TABLE "vault_browser_enrollments" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "auth_version" integer NOT NULL CHECK ("auth_version" > 0),
  "session_hash" text NOT NULL,
  "pairing" jsonb NOT NULL,
  "envelope" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "vault_browser_enrollments_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "vault_browser_enrollments_owner_expiry_idx" ON "vault_browser_enrollments" ("account_id", "user_id", "expires_at");
--> statement-breakpoint
ALTER TABLE "vault_browser_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "vault_browser_enrollments_owner_policy" ON "vault_browser_enrollments"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
