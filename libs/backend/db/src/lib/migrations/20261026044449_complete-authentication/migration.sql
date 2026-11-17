CREATE TABLE "auth_device_approvals" (
	"id" uuid PRIMARY KEY,
	"session_id" varchar(128) NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid,
	"approver_session_id" varchar(128),
	"approver" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_device_approvals_status_check" CHECK ("status" IN ('pending','approved','denied','cancelled','consumed')),
	CONSTRAINT "auth_device_approvals_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "auth_federated_identities" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_flows" (
	"id" uuid PRIMARY KEY,
	"session_id" varchar(128) NOT NULL,
	"user_id" uuid,
	"auth_version" integer,
	"purpose" text NOT NULL,
	"email" text,
	"code_hash" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_flows_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
	CONSTRAINT "auth_flows_purpose_check" CHECK ("purpose" IN ('email_verify','email_change','password_login','password_reset','recovery','google_login','google_link','google_reauth','enrollment','reauth'))
);
--> statement-breakpoint
CREATE TABLE "auth_recovery_codes" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_totp_enrollments" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"encrypted_secret" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_step" bigint DEFAULT -1 NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"auth_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_totp_status_check" CHECK ("status" IN ('pending','active','revoked'))
);
--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD COLUMN "pending_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "auth_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_device_approvals_expiry_idx" ON "auth_device_approvals" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_federated_subject_idx" ON "auth_federated_identities" ("issuer","subject");--> statement-breakpoint
CREATE INDEX "auth_federated_user_idx" ON "auth_federated_identities" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_flows_session_idx" ON "auth_flows" ("session_id");--> statement-breakpoint
CREATE INDEX "auth_flows_user_idx" ON "auth_flows" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_flows_expiry_idx" ON "auth_flows" ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_recovery_codes_user_idx" ON "auth_recovery_codes" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_totp_active_idx" ON "auth_totp_enrollments" ("user_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_verified_email_idx" ON "auth_users" ("email") WHERE "email_verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_users_email_idx" ON "auth_users" ("email");--> statement-breakpoint
ALTER TABLE "auth_device_approvals" ADD CONSTRAINT "auth_device_approvals_session_id_auth_sessions_sid_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("sid");--> statement-breakpoint
ALTER TABLE "auth_device_approvals" ADD CONSTRAINT "auth_device_approvals_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id");--> statement-breakpoint
ALTER TABLE "auth_device_approvals" ADD CONSTRAINT "auth_device_approvals_x8JSMQfcQ9C9_fkey" FOREIGN KEY ("approver_session_id") REFERENCES "auth_sessions"("sid");--> statement-breakpoint
ALTER TABLE "auth_federated_identities" ADD CONSTRAINT "auth_federated_identities_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_session_id_auth_sessions_sid_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("sid");--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_recovery_codes" ADD CONSTRAINT "auth_recovery_codes_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_totp_enrollments" ADD CONSTRAINT "auth_totp_enrollments_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_totp_enrollments" ADD CONSTRAINT "auth_totp_enrollments_session_id_auth_sessions_sid_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("sid");--> statement-breakpoint
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_version_check" CHECK ("auth_version" > 0);--> statement-breakpoint
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_email_check" CHECK ("email_verified_at" IS NULL OR "email" IS NOT NULL);