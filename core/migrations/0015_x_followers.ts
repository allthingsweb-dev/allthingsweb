import { statements } from "./statements.ts";

/**
 * How many follow each person on X, as read from public data at
 * `x_followers_at` (src/followers.ts): speaker lists are ordered by it.
 * Ships with the app's drizzle migration 0027_x_followers, which makes the
 * same schema. The count and its time are set together or not at all.
 */
export const xFollowers: ReadonlyArray<string> = [
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_followers" integer`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_followers_at" timestamp with time zone`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_followers_check" CHECK ("x_followers" >= 0)`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_followers_at_check" CHECK (("x_followers" IS NULL) = ("x_followers_at" IS NULL))`,
];

export default statements(xFollowers);
