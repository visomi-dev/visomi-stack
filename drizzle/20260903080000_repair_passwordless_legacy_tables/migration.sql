CREATE TABLE IF NOT EXISTS "auth_verification_challenges" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "purpose" text NOT NULL,
  "pin_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_sent_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_passkey_enrollments" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "credential_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "verification_challenge_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "activated_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_devices" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_webauthn_challenges" (
  "id" text PRIMARY KEY,
  "account_id" text,
  "user_id" text,
  "challenge_hash" text NOT NULL,
  "purpose" text NOT NULL,
  "ceremony_type" text NOT NULL DEFAULT 'authentication',
  "session_binding" text NOT NULL DEFAULT 'legacy',
  "flow_id" text,
  "credential_id" text,
  "allow_credential_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rp_id" text NOT NULL,
  "origin" text NOT NULL,
  "user_verification" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_token_hash_idx" ON "user_devices" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_devices_user_expires_idx" ON "user_devices" ("user_id", "expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_webauthn_challenges_hash_idx" ON "account_webauthn_challenges" ("challenge_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_webauthn_challenges_account_expiry_idx" ON "account_webauthn_challenges" ("account_id", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_passkey_enrollments_account_status_idx"
  ON "account_passkey_enrollments" ("account_id", "status");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auth_verification_challenges_user_id_users_id_fkey'
  ) THEN
    ALTER TABLE "auth_verification_challenges"
      ADD CONSTRAINT "auth_verification_challenges_user_id_users_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_devices_user_id_users_id_fkey'
  ) THEN
    ALTER TABLE "user_devices"
      ADD CONSTRAINT "user_devices_user_id_users_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_webauthn_challenges_account_id_accounts_id_fkey'
  ) THEN
    ALTER TABLE "account_webauthn_challenges"
      ADD CONSTRAINT "account_webauthn_challenges_account_id_accounts_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_webauthn_challenges_user_id_users_id_fkey'
  ) THEN
    ALTER TABLE "account_webauthn_challenges"
      ADD CONSTRAINT "account_webauthn_challenges_user_id_users_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_passkey_enrollments_account_id_accounts_id_fkey'
  ) THEN
    ALTER TABLE "account_passkey_enrollments"
      ADD CONSTRAINT "account_passkey_enrollments_account_id_accounts_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_passkey_enrollments_user_id_users_id_fkey'
  ) THEN
    ALTER TABLE "account_passkey_enrollments"
      ADD CONSTRAINT "account_passkey_enrollments_user_id_users_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_passkey_enrollments_verification_challenge_id_auth_verification_challenges_id_fkey'
  ) THEN
    ALTER TABLE "account_passkey_enrollments"
      ADD CONSTRAINT "account_passkey_enrollments_verification_challenge_id_auth_verification_challenges_id_fkey"
      FOREIGN KEY ("verification_challenge_id") REFERENCES "auth_verification_challenges"("id") ON DELETE SET NULL;
  END IF;
END $$;
