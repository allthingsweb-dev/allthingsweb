import { statements } from "./statements.ts";

/**
 * How many follow each person on X, as read from public data at
 * `x_followers_at` (src/followers.ts): speaker lists are ordered by it.
 * Ships with the app's drizzle migration 0027_x_followers, which makes the
 * same schema. The count and its time are set together or not at all, and
 * a changed (or cleared) X handle clears both, so a count is only ever the
 * current handle's.
 */
export const xFollowers: ReadonlyArray<string> = [
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_followers" integer`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_followers_at" timestamp with time zone`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_followers_check" CHECK ("x_followers" >= 0)`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_followers_at_check" CHECK (("x_followers" IS NULL) = ("x_followers_at" IS NULL))`,
  `CREATE FUNCTION "public"."profiles_x_followers_reset"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.twitter_handle IS DISTINCT FROM OLD.twitter_handle THEN
    NEW.x_followers := NULL;
    NEW.x_followers_at := NULL;
  END IF;
  RETURN NEW;
END
$$`,
  `CREATE TRIGGER "profiles_x_followers_reset" BEFORE UPDATE OF "twitter_handle" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_x_followers_reset"()`,
];

export default statements(xFollowers);
