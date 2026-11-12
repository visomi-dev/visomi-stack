ALTER TABLE "auth_credentials" ADD COLUMN "aaguid" uuid;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD COLUMN "label_is_custom" boolean;