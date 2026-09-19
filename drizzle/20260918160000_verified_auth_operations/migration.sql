ALTER TABLE "auth_operation_grants" ADD COLUMN "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "auth_operation_grants" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;
