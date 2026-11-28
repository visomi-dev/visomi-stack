ALTER TABLE "vault_key_challenges" ADD COLUMN "pairing_r1" text;--> statement-breakpoint
ALTER TABLE "vault_key_challenges" ADD COLUMN "pairing_a1" jsonb;--> statement-breakpoint
ALTER TABLE "vault_key_challenges" ADD COLUMN "pairing_r2" text;