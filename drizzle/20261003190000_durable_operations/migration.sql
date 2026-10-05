CREATE TABLE "durable_operations" (
  "id" text PRIMARY KEY,
  "owner" text NOT NULL,
  "request_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "session_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "auth_version" integer NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "result" jsonb,
  "error" jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "lease" text,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "durable_operations_status_check" CHECK ("status" IN ('pending', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "durable_operations_request_idx" ON "durable_operations" ("owner", "request_key");
--> statement-breakpoint
CREATE INDEX "durable_operations_pending_idx" ON "durable_operations" ("status", "available_at");
--> statement-breakpoint
ALTER TABLE "durable_operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "durable_operations_account_policy" ON "durable_operations"
  USING ("account_id" = current_setting('app.current_account_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true));
