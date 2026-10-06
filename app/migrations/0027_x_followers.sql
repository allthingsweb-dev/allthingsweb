-- How many follow each person on X, with when it was read; core/migrations/0015_x_followers.ts is the same change.
ALTER TABLE "profiles" ADD COLUMN "x_followers" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "x_followers_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_followers_check" CHECK ("x_followers" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_followers_at_check" CHECK (("x_followers" IS NULL) = ("x_followers_at" IS NULL));