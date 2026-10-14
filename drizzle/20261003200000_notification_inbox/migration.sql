CREATE TABLE "notification_inbox" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_inbox_kind_check" CHECK ("kind" IN ('service', 'security'))
);
--> statement-breakpoint
CREATE INDEX "notification_inbox_owner_idx" ON "notification_inbox" ("account_id", "user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "service_push" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_owner_idx" ON "notification_preferences" ("account_id", "user_id");
--> statement-breakpoint
ALTER TABLE "notification_inbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notification_inbox_owner_policy" ON "notification_inbox"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notification_preferences_owner_policy" ON "notification_preferences"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
