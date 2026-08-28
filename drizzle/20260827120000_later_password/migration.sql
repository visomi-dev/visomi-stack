ALTER TABLE "users" ADD COLUMN "password_configured" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
