-- Each profile's X account by its numeric id, beside its handle; core/migrations/0019_x_user_ids.ts is the same change.
ALTER TABLE "profiles" ADD COLUMN "x_user_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "x_handle_lost" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "x_handle_lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_user_id_unique" UNIQUE("x_user_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_user_id_check" CHECK ("x_user_id" ~ '^[0-9]{1,20}$');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_handle_lost_check" CHECK (("x_handle_lost" IS NULL) = ("x_handle_lost_at" IS NULL));--> statement-breakpoint
-- A handle edited by hand clears what the refresh knew about the old account (not modelled by drizzle).
CREATE OR REPLACE FUNCTION "public"."profiles_x_followers_reset"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.twitter_handle IS DISTINCT FROM OLD.twitter_handle THEN
    NEW.x_followers := NULL;
    NEW.x_followers_at := NULL;
    NEW.x_followers_tried_at := NULL;
    NEW.x_user_id := NULL;
    NEW.x_handle_lost := NULL;
    NEW.x_handle_lost_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
