ALTER TABLE "account_webauthn_challenges" ALTER COLUMN "account_id" DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "account_passkey_credentials_account_label_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "account_passkey_credentials_account_label_idx" ON "account_passkey_credentials" ("account_id", "label") WHERE "status" <> 'revoked';
--> statement-breakpoint
DROP INDEX IF EXISTS "account_passkey_credentials_account_status_idx";
--> statement-breakpoint
CREATE INDEX "account_passkey_credentials_account_status_idx" ON "account_passkey_credentials" ("account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_passkey_credentials_enrollment_flow_idx" ON "account_passkey_credentials" ("enrollment_flow_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_webauthn_challenges_session_idx" ON "account_webauthn_challenges" ("session_binding", "purpose", "consumed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_webauthn_challenges_flow_idx" ON "account_webauthn_challenges" ("flow_id", "purpose");
