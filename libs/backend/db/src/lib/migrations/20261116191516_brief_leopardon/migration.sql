ALTER TABLE "persistence_commands" ADD COLUMN "domain" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_opaque_commands" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_opaque_events" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_opaque_streams" ADD COLUMN "floor_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_opaque_streams" ADD COLUMN "floor_checkpoint" text;--> statement-breakpoint
ALTER TABLE "vault_opaque_units" ADD COLUMN "tombstone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_opaque_units" ALTER COLUMN "envelope" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "persistence_command_retention" ON "persistence_commands" ("tenant_id","scope_id","domain","created_at");--> statement-breakpoint
CREATE INDEX "vault_command_retention" ON "vault_opaque_commands" ("tenant_id","scope_id","domain","created_at");--> statement-breakpoint
CREATE INDEX "vault_event_retention" ON "vault_opaque_events" ("tenant_id","scope_id","domain","created_at");--> statement-breakpoint
ALTER TABLE "vault_opaque_streams" ADD CONSTRAINT "vault_stream_floor" CHECK ("floor_cursor" >= 0 AND "floor_cursor" <= "cursor" AND (("floor_cursor" = 0 AND "floor_checkpoint" IS NULL) OR ("floor_cursor" > 0 AND "floor_checkpoint" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "vault_opaque_units" ADD CONSTRAINT "vault_unit_gravestone" CHECK (("envelope" IS NOT NULL AND "bytes" > 0) OR ("envelope" IS NULL AND "tombstone" AND "bytes" = 0));--> statement-breakpoint
ALTER TABLE "vault_opaque_units" DROP CONSTRAINT "vault_unit_versions", ADD CONSTRAINT "vault_unit_versions" CHECK ("revision" > 0 AND "generation" > 0 AND "cursor" > 0 AND "bytes" >= 0);
--> statement-breakpoint
-- Existing envelope metadata identifies explicit deletions; no plaintext is inspected.
UPDATE "vault_opaque_units" SET "tombstone" = true WHERE "envelope"->'context'->>'kind' = 'tombstone';
