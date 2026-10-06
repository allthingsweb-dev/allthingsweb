-- How many follow each person on X, with when it was read; core/migrations/0015_x_followers.ts is the same change.
ALTER TABLE "profiles" ADD COLUMN "x_followers" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "x_followers_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_followers_check" CHECK ("x_followers" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_x_followers_at_check" CHECK (("x_followers" IS NULL) = ("x_followers_at" IS NULL));--> statement-breakpoint
-- A changed or cleared X handle clears its count (not modelled by drizzle; core's 0015 runs the same).
CREATE FUNCTION "public"."profiles_x_followers_reset"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.twitter_handle IS DISTINCT FROM OLD.twitter_handle THEN
    NEW.x_followers := NULL;
    NEW.x_followers_at := NULL;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "profiles_x_followers_reset" BEFORE UPDATE OF "twitter_handle" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_x_followers_reset"();
