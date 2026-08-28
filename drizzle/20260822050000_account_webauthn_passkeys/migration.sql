CREATE TABLE "account_passkey_credentials" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"rp_id" text NOT NULL,
	"label" text NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sign_count" integer DEFAULT 0 NOT NULL,
	"backup_eligible" boolean DEFAULT false NOT NULL,
	"backup_state" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_passkey_credentials_credential_idx" ON "account_passkey_credentials" ("credential_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_passkey_credentials_account_label_idx" ON "account_passkey_credentials" ("account_id", "label");
--> statement-breakpoint
CREATE INDEX "account_passkey_credentials_account_status_idx" ON "account_passkey_credentials" ("account_id", "revoked_at");
--> statement-breakpoint
ALTER TABLE "account_passkey_credentials" ADD CONSTRAINT "account_passkey_credentials_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "account_passkey_credentials" ADD CONSTRAINT "account_passkey_credentials_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE "account_webauthn_challenges" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"user_id" text,
	"challenge_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"rp_id" text NOT NULL,
	"origin" text NOT NULL,
	"user_verification" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_webauthn_challenges_hash_idx" ON "account_webauthn_challenges" ("challenge_hash");
--> statement-breakpoint
CREATE INDEX "account_webauthn_challenges_account_expiry_idx" ON "account_webauthn_challenges" ("account_id", "expires_at");
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD CONSTRAINT "account_webauthn_challenges_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "account_webauthn_challenges" ADD CONSTRAINT "account_webauthn_challenges_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
