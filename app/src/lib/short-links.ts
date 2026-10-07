import { and, eq, inArray, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { eventSlugsTable, eventsTable } from "@/lib/schema";

/**
 * The long slug of the published event at `link`: a short link the new
 * site gives (core/src/short-slugs.ts), the one it uses now or one it had.
 * Null for any other path. Promotion drafts print short links; until
 * allthings.dev serves them, this site sends them to the event's page.
 */
export async function longSlugForShortLink(
  database: Pick<PgDatabase<PgQueryResultHKT>, "select">,
  link: string,
): Promise<string | null> {
  const [event] = await database
    .select({ slug: eventsTable.slug })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.isDraft, false),
        or(
          eq(eventsTable.shortSlug, link),
          inArray(
            eventsTable.id,
            database
              .select({ id: eventSlugsTable.eventId })
              .from(eventSlugsTable)
              .where(eq(eventSlugsTable.slug, link)),
          ),
        ),
      ),
    )
    .limit(1);
  return event?.slug ?? null;
}

/**
 * The short link of the published event whose long slug is `slug`, if it
 * has one: where the cutover sends the event's old address (cutover.ts).
 */
export async function shortLinkForLongSlug(
  database: Pick<PgDatabase<PgQueryResultHKT>, "select">,
  slug: string,
): Promise<string | null> {
  const [event] = await database
    .select({ shortSlug: eventsTable.shortSlug })
    .from(eventsTable)
    .where(and(eq(eventsTable.isDraft, false), eq(eventsTable.slug, slug)))
    .limit(1);
  return event?.shortSlug ?? null;
}
