-- The studio's own policy on each collaboration table, and planning.collab_row_counts(); core/migrations/0029_studio_collab.ts is the same change. drizzle can't make a role only where it is missing, nor declare the function, so both are written here by hand: the role before the policies that name it.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'studio') THEN
    CREATE ROLE studio NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$role$;--> statement-breakpoint
CREATE POLICY "brief_sections_studio" ON "planning"."brief_sections" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "collab_audit_studio" ON "planning"."collab_audit" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "collaborators_studio" ON "planning"."collaborators" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "comments_studio" ON "planning"."comments" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "logistics_confirmations_studio" ON "planning"."logistics_confirmations" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "logistics_items_studio" ON "planning"."logistics_items" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "reviews_studio" ON "planning"."reviews" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "round_submissions_studio" ON "planning"."round_submissions" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "rounds_studio" ON "planning"."rounds" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tasks_studio" ON "planning"."tasks" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE FUNCTION "planning"."collab_row_counts"()
  RETURNS TABLE ("relname" text, "rows" bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'rounds'::text, count(*) FROM planning.rounds
  UNION ALL
  SELECT 'collaborators'::text, count(*) FROM planning.collaborators
  UNION ALL
  SELECT 'brief_sections'::text, count(*) FROM planning.brief_sections
  UNION ALL
  SELECT 'tasks'::text, count(*) FROM planning.tasks
  UNION ALL
  SELECT 'logistics_items'::text, count(*) FROM planning.logistics_items
  UNION ALL
  SELECT 'logistics_confirmations'::text, count(*) FROM planning.logistics_confirmations
  UNION ALL
  SELECT 'round_submissions'::text, count(*) FROM planning.round_submissions
  UNION ALL
  SELECT 'reviews'::text, count(*) FROM planning.reviews
  UNION ALL
  SELECT 'comments'::text, count(*) FROM planning.comments
  UNION ALL
  SELECT 'collab_audit'::text, count(*) FROM planning.collab_audit
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "planning"."collab_row_counts"() FROM PUBLIC;
