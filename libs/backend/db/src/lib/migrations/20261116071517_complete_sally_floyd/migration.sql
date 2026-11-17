CREATE TABLE "persistence_commands" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"user_id" uuid,
	"operation_id" uuid,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persistence_commands_pkey" PRIMARY KEY("tenant_id","scope_id","user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "persistence_grants" (
	"tenant_id" uuid,
	"scope_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	CONSTRAINT "persistence_grants_pkey" PRIMARY KEY("tenant_id","scope_id","user_id"),
	CONSTRAINT "persistence_grant_role" CHECK ("role" IN ('viewer','editor','manager','blocked'))
);
--> statement-breakpoint
CREATE TABLE "persistence_memberships" (
	"tenant_id" uuid,
	"user_id" uuid,
	"owner" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "persistence_memberships_pkey" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "persistence_records" (
	"id" uuid,
	"tenant_id" uuid,
	"scope_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "persistence_records_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "persistence_record_revision" CHECK ("revision" > 0),
	CONSTRAINT "persistence_record_audience" CHECK ("audience" IN ('owner','scope'))
);
--> statement-breakpoint
CREATE TABLE "persistence_scopes" (
	"id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	CONSTRAINT "persistence_scope_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "persistence_scope_kind" CHECK ("kind" IN ('tenant','group','resource')),
	CONSTRAINT "persistence_scope_root" CHECK (("kind" = 'tenant' AND "id" = "tenant_id" AND "parent_id" IS NULL) OR ("kind" <> 'tenant' AND "parent_id" IS NOT NULL AND "id" <> "parent_id"))
);
--> statement-breakpoint
CREATE TABLE "persistence_tenants" (
	"id" uuid PRIMARY KEY,
	"product" text NOT NULL,
	"policy_hash" text NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persistence_tenant_epoch" CHECK ("epoch" > 0)
);
--> statement-breakpoint
CREATE INDEX "persistence_membership_user" ON "persistence_memberships" ("user_id");--> statement-breakpoint
CREATE INDEX "persistence_record_page" ON "persistence_records" ("tenant_id","scope_id","domain","id");--> statement-breakpoint
CREATE INDEX "persistence_scope_parent" ON "persistence_scopes" ("tenant_id","parent_id");--> statement-breakpoint
ALTER TABLE "persistence_commands" ADD CONSTRAINT "persistence_commands_Z5J9u9DKIiar_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_commands" ADD CONSTRAINT "persistence_commands_qNeXL66WsR0o_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "persistence_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_grants" ADD CONSTRAINT "persistence_grants_qjqGSz2vDkS0_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_grants" ADD CONSTRAINT "persistence_grants_vUgeVPWFDvtD_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "persistence_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_memberships" ADD CONSTRAINT "persistence_memberships_tenant_id_persistence_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "persistence_tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_memberships" ADD CONSTRAINT "persistence_memberships_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_records" ADD CONSTRAINT "persistence_records_owner_id_auth_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth_users"("id");--> statement-breakpoint
ALTER TABLE "persistence_records" ADD CONSTRAINT "persistence_records_cNbEf7qQ0jxt_fkey" FOREIGN KEY ("tenant_id","scope_id") REFERENCES "persistence_scopes"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_scopes" ADD CONSTRAINT "persistence_scopes_tenant_id_persistence_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "persistence_tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "persistence_scopes" ADD CONSTRAINT "persistence_scopes_7vGc0dk5RPXM_fkey" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "persistence_scopes"("tenant_id","id");