-- Every person's page has an address, /people/<slug>, from their name: person_slug(), profiles.slug kept by a trigger, and profile_slugs for retired addresses; core/migrations/0017_person_slugs.ts is the same change.
CREATE FUNCTION "public"."person_slug"("name" text) RETURNS text
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
    $slug$;--> statement-breakpoint
ALTER TABLE "public"."profiles" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE "public"."profile_slugs" (
    "slug" text PRIMARY KEY NOT NULL,
    "profile_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "profile_slugs_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "profile_slugs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE
  );--> statement-breakpoint
CREATE INDEX "profile_slugs_profile_id_idx" ON "public"."profile_slugs" USING btree ("profile_id");--> statement-breakpoint
CREATE FUNCTION "public"."profiles_slug"() RETURNS trigger
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
            SELECT 1 FROM "public"."profile_slugs" WHERE "slug" = candidate
          ) LOOP
          n := n + 1;
          candidate := base || '-' || n;
        END LOOP;
        NEW."slug" := candidate;
      END IF;
      IF (TG_OP = 'INSERT' OR NEW."slug" IS DISTINCT FROM OLD."slug")
        AND EXISTS (
          SELECT 1 FROM "public"."profile_slugs" WHERE "slug" = NEW."slug"
        ) THEN
        RAISE EXCEPTION 'The slug % is retired: its address redirects to someone''s page', NEW."slug"
          USING ERRCODE = 'unique_violation';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD."slug" <> ''
        AND NEW."slug" IS DISTINCT FROM OLD."slug" THEN
        INSERT INTO "public"."profile_slugs" ("slug", "profile_id")
          VALUES (OLD."slug", NEW."id");
      END IF;
      RETURN NEW;
    END
    $trigger$;--> statement-breakpoint
CREATE TRIGGER "profiles_slug" BEFORE INSERT OR UPDATE OF "name", "slug" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_slug"();--> statement-breakpoint
DO $backfill$
  DECLARE
    profile record;
  BEGIN
    FOR profile IN
      SELECT "id" FROM "public"."profiles" ORDER BY "created_at", "id"
    LOOP
      UPDATE "public"."profiles" SET "slug" = '' WHERE "id" = profile."id";
    END LOOP;
  END
  $backfill$;--> statement-breakpoint
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_slug_unique" UNIQUE ("slug");--> statement-breakpoint
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."profile_slugs" TO site_reader;
    END IF;
  END
  $grant$;