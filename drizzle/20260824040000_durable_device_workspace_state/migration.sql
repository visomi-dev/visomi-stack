CREATE TABLE IF NOT EXISTS "sync_devices" (
  "device_id" text PRIMARY KEY,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "public_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "label" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  UNIQUE ("account_id", "fingerprint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_workspace_versions" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("account_id", "workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_workspace_approvals" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL REFERENCES "sync_devices"("device_id") ON DELETE CASCADE,
  "approved_at" timestamptz NOT NULL,
  PRIMARY KEY ("account_id", "workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_device_grants" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL REFERENCES "sync_devices"("device_id") ON DELETE CASCADE,
  "enrollment_version" integer NOT NULL,
  "object_key" text NOT NULL,
  "ciphertext_sha256" text NOT NULL,
  "enrolled_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  PRIMARY KEY ("account_id", "workspace_id", "device_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_device_audit" (
  "id" bigserial PRIMARY KEY,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "kind" text NOT NULL,
  "workspace_id" text,
  "at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_device_audit_account_at_idx" ON "sync_device_audit" ("account_id", "at");
