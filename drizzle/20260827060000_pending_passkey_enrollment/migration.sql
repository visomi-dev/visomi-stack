CREATE TABLE "account_passkey_enrollments" (
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
CREATE INDEX "account_passkey_enrollments_account_status_idx" ON "account_passkey_enrollments" ("account_id", "status");
--> statement-breakpoint
ALTER TABLE "account_passkey_enrollments" ADD CONSTRAINT "account_passkey_enrollments_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "account_passkey_enrollments" ADD CONSTRAINT "account_passkey_enrollments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "account_passkey_enrollments" ADD CONSTRAINT "account_passkey_enrollments_verification_challenge_id_auth_verification_challenges_id_fkey" FOREIGN KEY ("verification_challenge_id") REFERENCES "auth_verification_challenges"("id") ON DELETE SET NULL;
