CREATE TABLE IF NOT EXISTS "auth_identity_flows" (
  "id" text PRIMARY KEY,
  "state" text NOT NULL DEFAULT 'passkey',
  "expires_at" timestamptz NOT NULL,
  "session_binding" text NOT NULL,
  "email_hash" text,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL,
  "authorization_method" text,
  "completed_at" timestamptz,
  "terminal_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_identity_flows_session_idx" ON "auth_identity_flows" ("session_binding", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_device_approval_requests" (
  "id" text PRIMARY KEY,
  "user_code_hash" text NOT NULL,
  "requester_session_hash" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "approval_credential_id" text,
  "approved_at" timestamptz,
  "denied_at" timestamptz,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_device_approval_requests_requester_idx" ON "auth_device_approval_requests" ("requester_session_hash", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_federated_identities" (
  "id" text PRIMARY KEY,
  "provider" text NOT NULL,
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email_at_link" text NOT NULL,
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "user_federated_identities_issuer_subject_idx" UNIQUE ("issuer", "subject")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_audit_events" (
  "id" text PRIMARY KEY,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL,
  "event" text NOT NULL,
  "outcome" text NOT NULL,
  "context_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_enrollment_grants" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "requester_session_hash" text NOT NULL,
  "source" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_enrollment_grants_session_idx" ON "auth_enrollment_grants" ("requester_session_hash", "expires_at");
--> statement-breakpoint
ALTER TABLE "auth_email_challenges" DROP CONSTRAINT IF EXISTS "auth_email_challenges_purpose_check";
--> statement-breakpoint
ALTER TABLE "auth_email_challenges" ADD CONSTRAINT "auth_email_challenges_purpose_check" CHECK ("purpose" IN ('bootstrap_recovery', 'existing_account_recovery'));
