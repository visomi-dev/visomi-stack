CREATE TABLE "vault_unlock_methods" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "credential_record_id" text NOT NULL REFERENCES "account_passkey_credentials" ("id") ON DELETE CASCADE,
  "envelope" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  CONSTRAINT "vault_unlock_methods_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_unlock_methods_active_credential_idx" ON "vault_unlock_methods"
  ("account_id", "user_id", "credential_record_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "vault_unlock_assertions" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "credential_record_id" text NOT NULL REFERENCES "account_passkey_credentials" ("id") ON DELETE CASCADE,
  "auth_version" integer NOT NULL CHECK ("auth_version" > 0),
  "session_hash" text NOT NULL,
  "purpose" text NOT NULL CHECK ("purpose" IN ('enroll', 'unlock')),
  "method_id" text NOT NULL,
  "prf_input" text NOT NULL,
  "challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  CONSTRAINT "vault_unlock_assertions_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "vault_unlock_assertions_owner_expiry_idx" ON "vault_unlock_assertions" ("account_id", "user_id", "expires_at");
--> statement-breakpoint
ALTER TABLE "vault_unlock_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "vault_unlock_methods_owner_policy" ON "vault_unlock_methods"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
--> statement-breakpoint
ALTER TABLE "vault_unlock_assertions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "vault_unlock_assertions_owner_policy" ON "vault_unlock_assertions"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
