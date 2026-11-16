CREATE TABLE "vault_key_challenges" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"id" uuid,
	"owner_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "vault_key_challenges_pkey" PRIMARY KEY("tenant_id","scope_id","domain","id")
);
--> statement-breakpoint
CREATE TABLE "vault_key_devices" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"id" uuid,
	"owner_id" uuid NOT NULL,
	"signing" text NOT NULL,
	"encryption" text NOT NULL,
	"challenge" jsonb NOT NULL,
	"delivery" jsonb,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "vault_key_devices_pkey" PRIMARY KEY("tenant_id","scope_id","domain","id")
);
--> statement-breakpoint
CREATE TABLE "vault_key_scopes" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"phase" text DEFAULT 'ready' NOT NULL,
	CONSTRAINT "vault_key_scopes_pkey" PRIMARY KEY("tenant_id","scope_id","domain"),
	CONSTRAINT "vault_key_generation" CHECK ("generation" > 0 AND "epoch" > 0),
	CONSTRAINT "vault_key_phase" CHECK ("phase" IN ('ready','rotating'))
);
--> statement-breakpoint
CREATE TABLE "vault_opaque_commands" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"user_id" uuid,
	"operation_id" uuid,
	"fingerprint" text NOT NULL,
	"cursor" integer NOT NULL,
	"checkpoint" text NOT NULL,
	CONSTRAINT "vault_opaque_commands_pkey" PRIMARY KEY("tenant_id","scope_id","domain","user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "vault_opaque_events" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"cursor" integer,
	"checkpoint" text NOT NULL,
	"previous_checkpoint" text,
	"envelope" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "vault_opaque_events_pkey" PRIMARY KEY("tenant_id","scope_id","domain","cursor")
);
--> statement-breakpoint
CREATE TABLE "vault_opaque_streams" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"cursor" integer DEFAULT 0 NOT NULL,
	"checkpoint" text,
	CONSTRAINT "vault_opaque_streams_pkey" PRIMARY KEY("tenant_id","scope_id","domain"),
	CONSTRAINT "vault_stream_cursor" CHECK (("cursor" = 0 AND "checkpoint" IS NULL) OR ("cursor" > 0 AND "checkpoint" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "vault_opaque_units" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"domain" text,
	"id" uuid,
	"revision" integer NOT NULL,
	"generation" integer NOT NULL,
	"cursor" integer NOT NULL,
	"checkpoint" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_opaque_units_pkey" PRIMARY KEY("tenant_id","scope_id","domain","id"),
	CONSTRAINT "vault_unit_versions" CHECK ("revision" > 0 AND "generation" > 0 AND "cursor" > 0 AND "bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "vault_key_challenges" ADD CONSTRAINT "vault_key_challenges_bszqteMo8X2W_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_key_challenges" ADD CONSTRAINT "vault_key_challenges_v0M0tq3FbfHR_fkey" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "persistence_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_key_devices" ADD CONSTRAINT "vault_key_devices_RiN2e2KXmhg1_fkey" FOREIGN KEY ("tenant_id","scope_id","domain") REFERENCES "vault_key_scopes"("tenant_id","scope_id","domain") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_key_devices" ADD CONSTRAINT "vault_key_devices_TmqQwVyCYBmo_fkey" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "persistence_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_key_scopes" ADD CONSTRAINT "vault_key_scopes_qH7sfCtjQADP_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_opaque_commands" ADD CONSTRAINT "vault_opaque_commands_dXmmI4wZUuTy_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_opaque_events" ADD CONSTRAINT "vault_opaque_events_n5SKmEv0COsr_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_opaque_streams" ADD CONSTRAINT "vault_opaque_streams_nXnTxy2aPIFv_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vault_opaque_units" ADD CONSTRAINT "vault_opaque_units_pEtL1EFjNZfb_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;