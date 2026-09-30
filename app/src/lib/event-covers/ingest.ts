import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { eventsTable, imagesTable } from "@/lib/schema";

export type CoverImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: string;
  placeholder: string;
};

export type CoverIngestionDependencies = {
  database: Pick<
    PgDatabase<PgQueryResultHKT>,
    "select" | "insert" | "update" | "delete" | "transaction"
  >;
  /** The event's banner at its listing provider, or null when it has none. */
  findCoverUrl: (event: { lumaEventId: string }) => Promise<string | null>;
  download: (url: string) => Promise<Uint8Array>;
  process: (bytes: Uint8Array) => Promise<CoverImage>;
  /** Stores the image under `key` and returns its stored URL. */
  store: (key: string, image: CoverImage) => Promise<string>;
  newId: () => string;
  now: () => number;
};

export type CoverIngestionResult = {
  ingested: string[];
  withoutCover: string[];
  failed: { slug: string; error: string }[];
};

/**
 * Gives events without a cover their listing's banner. Covers set by hand are
 * never replaced, and one event's failure never stops the others.
 */
export async function ingestMissingCovers(
  deps: CoverIngestionDependencies,
  { budgetMs = 40_000 }: { budgetMs?: number } = {},
): Promise<CoverIngestionResult> {
  const deadline = deps.now() + budgetMs;
  const result: CoverIngestionResult = {
    ingested: [],
    withoutCover: [],
    failed: [],
  };
  const events = await deps.database
    .select({
      id: eventsTable.id,
      slug: eventsTable.slug,
      name: eventsTable.name,
      lumaEventId: eventsTable.lumaEventId,
    })
    .from(eventsTable)
    .where(
      and(isNull(eventsTable.previewImage), isNotNull(eventsTable.lumaEventId)),
    )
    .orderBy(desc(eventsTable.startDate));

  for (const event of events) {
    if (deps.now() >= deadline || event.lumaEventId === null) break;
    try {
      const coverUrl = await deps.findCoverUrl({
        lumaEventId: event.lumaEventId,
      });
      if (!coverUrl) {
        result.withoutCover.push(event.slug);
        continue;
      }
      const image = await deps.process(await deps.download(coverUrl));
      const imageId = deps.newId();
      const url = await deps.store(
        `events/${event.id}/cover-${imageId}.${image.format}`,
        image,
      );
      const assigned = await deps.database.transaction(async (tx) => {
        await tx.insert(imagesTable).values({
          id: imageId,
          url,
          alt: `${event.name} event cover`,
          placeholder: image.placeholder,
          width: image.width,
          height: image.height,
        });
        const updated = await tx
          .update(eventsTable)
          .set({ previewImage: imageId })
          .where(
            and(eq(eventsTable.id, event.id), isNull(eventsTable.previewImage)),
          )
          .returning({ id: eventsTable.id });
        if (updated.length === 0) {
          // Someone set a cover meanwhile; theirs wins.
          await tx.delete(imagesTable).where(eq(imagesTable.id, imageId));
        }
        return updated.length > 0;
      });
      if (assigned) result.ingested.push(event.slug);
    } catch (error) {
      result.failed.push({
        slug: event.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
