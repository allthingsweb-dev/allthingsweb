-- A hosting company's website and its X, Bluesky and LinkedIn handles; core/migrations/0006_host_links.ts is the same change.
ALTER TABLE "sponsors" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "twitter_handle" text;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "bluesky_handle" text;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "linkedin_handle" text;--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_website_url_check" CHECK ("website_url" ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$');--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_twitter_handle_check" CHECK ("twitter_handle" ~ '^[A-Za-z0-9_]{1,15}$');--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_bluesky_handle_check" CHECK ("bluesky_handle" ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$');--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_linkedin_handle_check" CHECK ("linkedin_handle" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$');