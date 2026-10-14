CREATE TABLE "vault_pin_profiles" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "profile" jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "attempts" integer NOT NULL DEFAULT 0,
  "window_started_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "vault_pin_profiles_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
  CONSTRAINT "vault_pin_profiles_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_pin_profiles_owner_idx" ON "vault_pin_profiles" ("account_id", "user_id");
--> statement-breakpoint
ALTER TABLE "vault_pin_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "vault_pin_profiles_owner_policy" ON "vault_pin_profiles"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
