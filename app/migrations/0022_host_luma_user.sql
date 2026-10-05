-- A hosting company's Luma account, unique and shaped as profiles' Luma user ids are; core/migrations/0010_host_luma_user.ts is the same change.
ALTER TABLE "sponsors" ADD COLUMN "luma_user_id" text;--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_luma_user_id_unique" UNIQUE("luma_user_id");--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_luma_user_id_check" CHECK ("luma_user_id" ~ '^usr-[A-Za-z0-9]+$');