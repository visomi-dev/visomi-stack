CREATE TABLE "vault_backup_staging" (
	"scope_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vault_backup_staging_bytes" CHECK ("bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "vault_backup_staging" ADD CONSTRAINT "vault_backup_staging_CP3cIQoiIiUi_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id");