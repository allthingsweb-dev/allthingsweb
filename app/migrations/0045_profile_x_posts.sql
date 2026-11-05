ALTER TABLE "profiles" ADD COLUMN "x_posts" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_posts_check" CHECK (jsonb_typeof("x_posts") = 'object');