import { statements } from "./statements.ts";

/**
 * Every person's page has an address: /people/<slug>, from their name.
 * Ships with the app's drizzle migration 0029_person_slugs, which makes the
 * same schema.
 *
 * - `person_slug(name)`: a name as a slug. Lowercase; the Latin letters
 *   with marks, and ß, æ, œ, þ and ð, as their plain spellings; every run of
 *   anything else as one hyphen; at most 64 characters; "person" for a name
 *   with no Latin letter or digit. core/src/person-slug.ts is the same
 *   function, and a test holds the two to each other.
 * - `profiles.slug`: unique, and set by a trigger, so every writer (the
 *   app, the Luma import, a backfill) gets one: from the name on insert,
 *   and again when the name changes to one with another slug. A taken slug
 *   gets "-2", "-3" and so on, past every slug in use or once used by
 *   someone else. An empty slug asks the trigger for one.
 * - `profile_slugs`: the slugs a person had before, so their old address
 *   answers with a permanent redirect to the new one. Taking an old slug
 *   back removes it from the list.
 *
 * Existing profiles get their slugs in the order they were created, so the
 * first of two people with one name keeps the plain slug.
 *
 * Production's read-only role, site_reader, may SELECT every table the
 * public site reads (infra/scripts/site-reader.ts), so profile_slugs gets
 * the grant here, where the role exists.
 */
export const personSlugs: ReadonlyArray<string> = [
  `CREATE FUNCTION "public"."person_slug"("name" text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $slug$
      SELECT COALESCE(
        NULLIF(
          trim(BOTH '-' FROM left(
            regexp_replace(
              translate(
                replace(replace(replace(replace(replace(lower("name"),
                  'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th'), 'ð', 'd'),
                'àáâãäåāăąçćčďđèéêëēĕėęěìíîïĩīįıłñńňòóôõöøōőŕřśšşťùúûüũūůűųýÿźżž',
                'aaaaaaaaacccddeeeeeeeeeiiiiiiiilnnnoooooooorrssstuuuuuuuuuyyzzz'
              ),
              '[^a-z0-9]+', '-', 'g'
            ),
            64
          )),
          ''
        ),
        'person'
      )
    $slug$`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "slug" text DEFAULT '' NOT NULL`,
  `CREATE TABLE "public"."profile_slugs" (
    "slug" text PRIMARY KEY NOT NULL,
    "profile_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "profile_slugs_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "profile_slugs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX "profile_slugs_profile_id_idx" ON "public"."profile_slugs" USING btree ("profile_id")`,
  // Existing people, oldest first: the first with a slug keeps it plain.
  `UPDATE "public"."profiles" AS p
    SET "slug" = CASE WHEN s.n = 1 THEN s.base ELSE s.base || '-' || s.n END
    FROM (
      SELECT "id", "public"."person_slug"("name") AS base,
        row_number() OVER (
          PARTITION BY "public"."person_slug"("name")
          ORDER BY "created_at", "id"
        ) AS n
      FROM "public"."profiles"
    ) AS s
    WHERE s."id" = p."id"`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_slug_unique" UNIQUE ("slug")`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
  `CREATE FUNCTION "public"."profiles_slug"() RETURNS trigger
    LANGUAGE plpgsql
    AS $trigger$
    DECLARE
      base text;
      candidate text;
      n integer := 1;
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW."slug" <> '' AND (
        NEW."slug" IS DISTINCT FROM OLD."slug"
        OR "public"."person_slug"(NEW."name") = "public"."person_slug"(OLD."name")
      ) THEN
        -- A slug set by hand, or a new name with the same slug: kept.
        NULL;
      ELSIF TG_OP = 'INSERT' AND NEW."slug" <> '' THEN
        NULL;
      ELSE
        base := "public"."person_slug"(NEW."name");
        candidate := base;
        WHILE EXISTS (
            SELECT 1 FROM "public"."profiles"
            WHERE "slug" = candidate AND "id" <> NEW."id"
          ) OR EXISTS (
            SELECT 1 FROM "public"."profile_slugs"
            WHERE "slug" = candidate AND "profile_id" <> NEW."id"
          ) LOOP
          n := n + 1;
          candidate := base || '-' || n;
        END LOOP;
        NEW."slug" := candidate;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW."slug" IS DISTINCT FROM OLD."slug" THEN
        INSERT INTO "public"."profile_slugs" ("slug", "profile_id")
          VALUES (OLD."slug", NEW."id")
          ON CONFLICT ("slug") DO NOTHING;
        DELETE FROM "public"."profile_slugs"
          WHERE "slug" = NEW."slug" AND "profile_id" = NEW."id";
      END IF;
      RETURN NEW;
    END
    $trigger$`,
  `CREATE TRIGGER "profiles_slug" BEFORE INSERT OR UPDATE OF "name", "slug" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_slug"()`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."profile_slugs" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(personSlugs);
