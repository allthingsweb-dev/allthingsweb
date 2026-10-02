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

type Cancellable = { signal: AbortSignal };

export type CoverIngestionDependencies = {
  database: Pick<
    PgDatabase<PgQueryResultHKT>,
    "select" | "insert" | "update" | "delete" | "transaction"
  >;
  /** The event's banner at its listing provider, or null when it has none. */
  findCoverUrl: (
    event: { lumaEventId: string },
    options: Cancellable,
  ) => Promise<string | null>;
  download: (url: string, options: Cancellable) => Promise<Uint8Array>;
  process: (bytes: Uint8Array) => Promise<CoverImage>;
  /** Stores the image under `key` and returns its stored URL. */
  store: (
    key: string,
    image: CoverImage,
    options: Cancellable,
  ) => Promise<string>;
  /** Deletes a stored image that did not become the event's cover. Runs even
   * after cancellation, so it should bound itself. */
  remove: (key: string) => Promise<void>;
  newId: () => string;
  now: () => number;
};

export type CoverIngestionResult = {
  ingested: string[];
  withoutCover: string[];
  failed: { slug: string; error: string }[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gives events without a cover their listing's banner. Covers set by hand are
 * never replaced, and one event's failure never stops the others.
 */
export async function ingestMissingCovers(
  deps: CoverIngestionDependencies,
  {
    budgetMs = 40_000,
    signal = new AbortController().signal,
  }: {
    /** How long to keep starting new events. */
    budgetMs?: number;
    /** Cancels the event in progress; no database write starts after it. */
    signal?: AbortSignal;
  } = {},
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
    if (
      deps.now() >= deadline ||
      signal.aborted ||
      event.lumaEventId === null
    ) {
      break;
    }
    // Set once the image is stored, cleared once it becomes the cover.
    let unusedKey: string | null = null;
    try {
      const coverUrl = await deps.findCoverUrl(
        { lumaEventId: event.lumaEventId },
        { signal },
      );
      if (!coverUrl) {
        result.withoutCover.push(event.slug);
        continue;
      }
      const image = await deps.process(
        await deps.download(coverUrl, { signal }),
      );
      const imageId = deps.newId();
      const key = `events/${event.id}/cover-${imageId}.${image.format}`;
      const url = await deps.store(key, image, { signal });
      unusedKey = key;
      signal.throwIfAborted();
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
      if (assigned) {
        unusedKey = null;
        result.ingested.push(event.slug);
      }
    } catch (error) {
      result.failed.push({ slug: event.slug, error: errorMessage(error) });
    }
    if (unusedKey) {
      await deps.remove(unusedKey).catch((error: unknown) => {
        result.failed.push({
          slug: event.slug,
          error: `Could not delete unused cover ${unusedKey}: ${errorMessage(error)}`,
        });
      });
    }
  }
  return result;
}
