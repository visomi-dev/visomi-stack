ALTER TABLE "auth_verification_challenges" ADD COLUMN "email" text;
--> statement-breakpoint
UPDATE "auth_verification_challenges" AS challenges
SET "email" = users."email"
FROM "users"
WHERE challenges."user_id" = users."id";
--> statement-breakpoint
ALTER TABLE "auth_verification_challenges" ALTER COLUMN "email" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "auth_verification_challenges" ALTER COLUMN "user_id" DROP NOT NULL;
