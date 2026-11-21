CREATE TABLE "cloud_share_links" (
	"tenant_id" uuid NOT NULL,
	"scope_id" uuid PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_share_links" ADD CONSTRAINT "cloud_share_links_XALabY9EZpqK_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;