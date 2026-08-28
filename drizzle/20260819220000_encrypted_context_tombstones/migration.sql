-- The legacy columns below were server-readable protected-data authority.  The
-- migration is intentionally destructive: recovery is from an approved local
-- agent export, never from a cloud plaintext compatibility column.
ALTER TABLE "projects" DROP COLUMN IF EXISTS "summary";
--> statement-breakpoint
ALTER TABLE "project_documents" DROP COLUMN IF EXISTS "content_markdown";
--> statement-breakpoint
ALTER TABLE "async_jobs" DROP COLUMN IF EXISTS "input_json";
--> statement-breakpoint
ALTER TABLE "async_jobs" DROP COLUMN IF EXISTS "result_json";
--> statement-breakpoint
ALTER TABLE "async_jobs" DROP COLUMN IF EXISTS "error_message";
--> statement-breakpoint
CREATE TABLE "encrypted_context_metadata" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL,
  "envelope_id" text NOT NULL,
  "revision" integer NOT NULL,
  "object_key" text NOT NULL,
  "ciphertext_sha256" text NOT NULL,
  "record_type" text NOT NULL,
  "state" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "tombstoned_at" timestamp with time zone,
  CONSTRAINT "encrypted_context_metadata_pk" PRIMARY KEY ("account_id", "project_id", "source_id"),
  CONSTRAINT "encrypted_context_metadata_envelope_revision_unique" UNIQUE
    ("account_id", "project_id", "envelope_id", "revision")
);
--> statement-breakpoint
CREATE TABLE "encrypted_context_tombstones" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL,
  "envelope_id" text NOT NULL,
  "revision" integer NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "encrypted_context_tombstones_pk" PRIMARY KEY
    ("account_id", "project_id", "source_id")
);
--> statement-breakpoint
CREATE TABLE "themis_migration_ledger" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL,
  "fingerprint" text NOT NULL,
  "envelope_id" text NOT NULL,
  "tombstoned_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "themis_migration_ledger_pk" PRIMARY KEY ("account_id", "project_id", "source_id")
);
--> statement-breakpoint
CREATE INDEX "encrypted_context_metadata_scope_idx"
  ON "encrypted_context_metadata" ("account_id", "project_id", "updated_at");
