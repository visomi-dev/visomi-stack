ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "intent" text NOT NULL DEFAULT 'sign_in';
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "password_proof_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "required_factor" text;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "user_auth_version" integer;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "factor_enrollment_id" text;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "factor_enrollment_version" integer;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "pending_password_hash" text;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "pending_email" text;
--> statement-breakpoint
ALTER TABLE "auth_identity_flows" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "auth_email_challenges" DROP CONSTRAINT IF EXISTS "auth_email_challenges_purpose_check";
--> statement-breakpoint
ALTER TABLE "auth_email_challenges" ADD CONSTRAINT "auth_email_challenges_purpose_check" CHECK ("purpose" IN ('bootstrap_recovery', 'existing_account_recovery', 'password_second_step', 'password_signup', 'password_reset'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_totp_enrollments" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "encrypted_secret" text NOT NULL,
  "key_version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "confirmed_at" timestamptz,
  "last_accepted_time_step" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_totp_enrollments_status_check" CHECK ("status" IN ('pending', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_totp_enrollments_user_status_idx" ON "user_totp_enrollments" ("user_id", "status");
