CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY,
	"session_id" varchar(128) NOT NULL,
	"purpose" text NOT NULL,
	"subject_id" uuid,
	"challenge_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_purpose_check" CHECK ("purpose" IN ('signup', 'enrollment', 'authentication')),
	CONSTRAINT "auth_challenges_subject_check" CHECK (("purpose" = 'authentication') = ("subject_id" IS NULL)),
	CONSTRAINT "auth_challenges_hash_check" CHECK ("challenge_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "auth_challenges_expiration_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_credentials" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"backup_eligible" boolean NOT NULL,
	"backup_state" boolean NOT NULL,
	"rp_id" text NOT NULL,
	"label" varchar(64) DEFAULT 'Passkey' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_credentials_counter_check" CHECK ("counter" >= 0 AND "counter" <= 9007199254740991),
	CONSTRAINT "auth_credentials_backup_check" CHECK (NOT "backup_state" OR "backup_eligible"),
	CONSTRAINT "auth_credentials_id_check" CHECK (length("credential_id") <= 1400 AND "credential_id" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "auth_credentials_key_check" CHECK (length("public_key") > 0),
	CONSTRAINT "auth_credentials_label_check" CHECK (length(trim("label")) > 0),
	CONSTRAINT "auth_credentials_transports_check" CHECK ("transports" <@ ARRAY['usb','nfc','ble','internal','hybrid','cable','smart-card']::text[])
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_rate_limits_attempts_check" CHECK ("attempts" > 0 AND "attempts" <= 10001)
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"sid" varchar(128) PRIMARY KEY,
	"sess" jsonb NOT NULL,
	"expire" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_revocation_check" CHECK ("revoked_at" IS NULL OR ("expire" <= "revoked_at" AND "sess" = '{}'::jsonb))
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_credentials_owner_idx" ON "auth_credentials" ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_expiry_idx" ON "auth_rate_limits" ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" ("expire");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" (("sess"->'passport'->'user'->>'id'));--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_auth_sessions_sid_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("sid") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;