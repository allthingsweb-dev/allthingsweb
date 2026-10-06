import { statements } from "./statements.ts";

/**
 * Each profile's X account by its numeric user id, which never changes,
 * beside the handle, which its owner can change and someone else can take
 * (src/followers.ts). `x_user_id` is the account's; no two profiles share
 * one. `x_handle_lost` is a handle the refresh cleared because X now gives
 * it to another account, with when (`x_handle_lost_at`): the profile keeps
 * its id, and the completeness report flags it until someone gives it its
 * handle again.
 *
 * Changing a handle by hand is changing the account, so the trigger from
 * 0015 now clears everything the refresh knew about the old one: its count
 * and times, its id and a lost handle. The refresh's own handle changes
 * (a renamed account, a handle lost) write those back in the same
 * transaction. Ships with the app's drizzle migration 0031_x_user_ids,
 * which makes the same schema.
 */
export const xUserIds: ReadonlyArray<string> = [
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_user_id" text`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_handle_lost" text`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_handle_lost_at" timestamp with time zone`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_user_id_unique" UNIQUE("x_user_id")`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_user_id_check" CHECK ("x_user_id" ~ '^[0-9]{1,20}$')`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_handle_lost_check" CHECK (("x_handle_lost" IS NULL) = ("x_handle_lost_at" IS NULL))`,
  `CREATE OR REPLACE FUNCTION "public"."profiles_x_followers_reset"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
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
$$`,
];

export default statements(xUserIds);
