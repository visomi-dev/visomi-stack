CREATE TABLE IF NOT EXISTS "user_recovery_codes" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_recovery_codes_user_idx" ON "user_recovery_codes" ("user_id", "used_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_operation_grants" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "session_binding" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_operation_grants_user_purpose_idx" ON "auth_operation_grants" ("user_id", "purpose", "expires_at");
