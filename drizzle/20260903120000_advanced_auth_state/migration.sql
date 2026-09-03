CREATE TABLE IF NOT EXISTS "auth_email_challenges" (
  "id" text PRIMARY KEY,
  "flow_id" text NOT NULL,
  "normalized_email" text NOT NULL,
  "purpose" text NOT NULL DEFAULT 'bootstrap_recovery',
  "pin_hash" text NOT NULL,
  "client_context_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "superseded_at" timestamptz,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_sent_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_email_challenges_flow_active_idx" ON "auth_email_challenges" ("flow_id") WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "account_passkey_credentials" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "account_passkey_credentials" ADD COLUMN IF NOT EXISTS "enrollment_flow_id" text;
--> statement-breakpoint
ALTER TABLE "account_passkey_credentials" ADD COLUMN IF NOT EXISTS "activated_at" timestamptz;
--> statement-breakpoint
UPDATE "account_passkey_credentials" SET "activated_at" = COALESCE("activated_at", "created_at") WHERE "status" = 'active';
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "ceremony_type" text NOT NULL DEFAULT 'authentication';
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "session_binding" text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "flow_id" text;
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "credential_id" text;
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "allow_credential_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
