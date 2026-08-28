CREATE TABLE "opaque_sync_cursors" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "high_water_cursor" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "opaque_sync_cursors_pk" PRIMARY KEY ("account_id", "workspace_id")
);
--> statement-breakpoint
CREATE TABLE "opaque_sync_envelopes" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "envelope_id" text NOT NULL,
  "revision" integer NOT NULL,
  "cursor" integer NOT NULL,
  "object_key" text NOT NULL,
  "ciphertext_sha256" text NOT NULL,
  "record_type" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "tombstoned_at" timestamp with time zone,
  CONSTRAINT "opaque_sync_envelopes_pk" PRIMARY KEY ("account_id", "workspace_id", "envelope_id", "revision"),
  CONSTRAINT "opaque_sync_envelopes_cursor_unique" UNIQUE ("account_id", "workspace_id", "cursor")
);
--> statement-breakpoint
CREATE INDEX "opaque_sync_envelopes_list_idx" ON "opaque_sync_envelopes" ("account_id", "workspace_id", "cursor");
--> statement-breakpoint
CREATE TABLE "opaque_sync_tombstones" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "envelope_id" text NOT NULL,
  "revision" integer NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "opaque_sync_tombstones_pk" PRIMARY KEY ("account_id", "workspace_id", "envelope_id", "revision")
);
