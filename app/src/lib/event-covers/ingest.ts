import { and, desc, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
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
  database: Pick<PgDatabase<PgQueryResultHKT>, "select"> & {
    execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
  };
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

/**
 * Records the image and makes it the event's cover in one statement, and only
 * if the event still has no cover; a cover set meanwhile wins and nothing is
 * written. One statement keeps this atomic without an interactive
 * transaction, which the production driver (neon-http) does not support.
 */
async function saveCover(
  database: CoverIngestionDependencies["database"],
  cover: {
    eventId: string;
    imageId: string;
    url: string;
    alt: string;
    image: CoverImage;
  },
): Promise<boolean> {
  const result = await database.execute(sql`
    with target as (
      select ${eventsTable.id} from ${eventsTable}
      where ${eventsTable.id} = ${cover.eventId}
        and ${eventsTable.previewImage} is null
      for update
    ), image as (
      insert into ${imagesTable}
        (id, url, alt, placeholder, width, height, created_at, updated_at)
      select ${cover.imageId}::uuid, ${cover.url}, ${cover.alt},
        ${cover.image.placeholder}, ${cover.image.width}::integer,
        ${cover.image.height}::integer, now(), now()
      from target
      returning id
    )
    update ${eventsTable}
    set preview_image = image.id, updated_at = now()
    from image
    where ${eventsTable.id} = ${cover.eventId}
    returning ${eventsTable.id}
  `);
  return result.rows.length > 0;
}

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
      const assigned = await saveCover(deps.database, {
        eventId: event.id,
        imageId,
        url,
        alt: `${event.name} event cover`,
        image,
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
