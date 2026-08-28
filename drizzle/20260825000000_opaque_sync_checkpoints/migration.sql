CREATE TABLE "opaque_sync_checkpoints" (
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "checkpoint_id" text NOT NULL,
  "cursor" integer NOT NULL,
  "revision" integer NOT NULL,
  "object_key" text NOT NULL,
  "ciphertext_sha256" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "opaque_sync_checkpoints_pk" PRIMARY KEY ("account_id", "workspace_id", "checkpoint_id"),
  CONSTRAINT "opaque_sync_checkpoints_cursor_unique" UNIQUE ("account_id", "workspace_id", "cursor")
);
--> statement-breakpoint
CREATE INDEX "opaque_sync_checkpoints_stream_idx"
  ON "opaque_sync_checkpoints" ("account_id", "workspace_id", "cursor");
