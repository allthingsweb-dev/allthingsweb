import { statements } from "./statements.ts";

/**
 * What a person does now (src/now.ts, docs/now.md): `profiles.now_record`,
 * one dated, sourced record as JSON, or null. Only the people backfill
 * writes it (src/people-enrichment.ts), from core/backfill/people.json,
 * and the record's shape is decoded there and wherever it is read; the
 * column only insists on an object. Taking someone's down is setting it
 * to null. Ships with the app's drizzle migration 0044_profile_now, which
 * makes the same schema.
 */
export const profileNow: ReadonlyArray<string> = [
  `ALTER TABLE "public"."profiles" ADD COLUMN "now_record" jsonb`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_now_record_check" CHECK (jsonb_typeof("now_record") = 'object')`,
];

export default statements(profileNow);
