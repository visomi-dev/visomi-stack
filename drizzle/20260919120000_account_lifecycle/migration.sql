ALTER TABLE "users" ADD COLUMN "display_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb NOT NULL DEFAULT '{"locale":"en","theme":"system"}'::jsonb;
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences_configured" boolean NOT NULL DEFAULT false;
