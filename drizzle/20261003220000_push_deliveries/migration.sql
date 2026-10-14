CREATE TABLE "push_deliveries" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "notification_id" text NOT NULL REFERENCES "notification_inbox" ("id") ON DELETE CASCADE,
  "subscription_id" text NOT NULL REFERENCES "push_subscriptions" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "lease" text,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "push_deliveries_status_check" CHECK ("status" IN ('pending', 'running', 'finished')),
  CONSTRAINT "push_deliveries_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3 AND "revision" > 0),
  CONSTRAINT "push_deliveries_membership_fk" FOREIGN KEY ("account_id", "user_id")
    REFERENCES "account_memberships" ("account_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_deliveries_event_idx" ON "push_deliveries" ("notification_id", "subscription_id");
--> statement-breakpoint
CREATE INDEX "push_deliveries_pending_idx" ON "push_deliveries" ("status", "available_at");
--> statement-breakpoint
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "push_deliveries_owner_policy" ON "push_deliveries"
  USING ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("account_id" = current_setting('app.current_account_id', true) AND "user_id" = current_setting('app.current_user_id', true));
