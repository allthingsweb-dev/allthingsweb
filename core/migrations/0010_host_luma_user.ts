import { statements } from "./statements.ts";

/**
 * A hosting company's Luma account, so the people import attaches the
 * company to an event Luma lists it as a host of, instead of leaving it
 * "not imported" as if it were a person. Ships with the app's drizzle
 * migration 0022_host_luma_user, which makes the same schema.
 *
 * The id is Luma's user id, checked for its shape as profiles' is, and
 * unique: one company per account. The values come from a sourced backfill
 * (backfill/hosts.json), never from here.
 */
export const hostLumaUser: ReadonlyArray<string> = [
  `ALTER TABLE "public"."sponsors" ADD COLUMN "luma_user_id" text`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_luma_user_id_unique" UNIQUE ("luma_user_id")`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_luma_user_id_check" CHECK ("luma_user_id" ~ '^usr-[A-Za-z0-9]+$')`,
];

export default statements(hostLumaUser);
