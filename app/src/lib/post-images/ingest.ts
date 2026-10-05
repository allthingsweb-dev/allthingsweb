import { sql, type SQL } from "drizzle-orm";
import { eventPostsTable, imagesTable } from "@/lib/schema";
import type {
  ProfilePhoto,
  ProfilePhotoDependencies,
} from "@/lib/profile-photos/ingest";

/**
 * Copies the images of posts about events into the bucket: each post's
 * first image (`image_source_url`) and its author's avatar
 * (`author_avatar_source_url`), as core's posts tool stored their sources.
 * The event page shows only the copies, never the platform's URLs.
 *
 * Like profile photos, an image already set is never replaced, and one
 * failure never stops the others.
 */

export type PostImageDependencies = Omit<
  ProfilePhotoDependencies,
  "database"
> & {
  database: {
    execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
  };
};

export type PostImageResult = {
  ingested: string[];
  failed: { url: string; error: string }[];
  /** Images still to copy when the run stopped: the next run takes them. */
  remaining: number;
};

/** The most images one run copies, whatever time is left. */
export const maxImagesPerRun = 40;

/** How long one image may take, download to save, before it is skipped. */
export const imageTimeoutMs = 8_000;

/** The two images a post can carry: its source column and its image column. */
const kinds = {
  image: {
    source: eventPostsTable.imageSourceUrl,
    target: eventPostsTable.image,
    alt: (author: string) => `Photo from ${author}'s post`,
  },
  avatar: {
    source: eventPostsTable.authorAvatarSourceUrl,
    target: eventPostsTable.authorAvatar,
    alt: (author: string) => author,
  },
} as const;

type Kind = keyof typeof kinds;

/** The bucket key for one of a post's images. */
export function postImageKey(
  postId: string,
  kind: Kind,
  imageId: string,
  format: string,
): string {
  return `posts/${postId}-${kind}-${imageId}.${format}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Missing = { id: string; author: string; source: string; kind: Kind };

/** Images still to copy, oldest posts first, avatars after photos. */
async function missing(
  database: PostImageDependencies["database"],
): Promise<Missing[]> {
  const rows: Missing[] = [];
  for (const kind of Object.keys(kinds) as Kind[]) {
    const { source, target } = kinds[kind];
    const result = await database.execute(sql`
      select ${eventPostsTable.id} as id, ${eventPostsTable.authorName} as author,
        ${source} as source
      from ${eventPostsTable}
      where ${target} is null and coalesce(${source}, '') <> ''
      order by ${eventPostsTable.addedAt}, ${eventPostsTable.id}
    `);
    for (const row of result.rows as Omit<Missing, "kind">[]) {
      rows.push({ ...row, kind });
    }
  }
  return rows;
}

/**
 * Records the image and sets it on the post in one statement, only while
 * the post still has none.
 */
async function saveImage(
  database: PostImageDependencies["database"],
  item: Missing,
  stored: { imageId: string; url: string; image: ProfilePhoto },
): Promise<boolean> {
  const { target } = kinds[item.kind];
  const column = sql.raw(`"${target.name}"`);
  const result = await database.execute(sql`
    with target as (
      select ${eventPostsTable.id} from ${eventPostsTable}
      where ${eventPostsTable.id} = ${item.id} and ${target} is null
      for update
    ), image as (
      insert into ${imagesTable}
        (id, url, alt, placeholder, width, height, created_at, updated_at)
      select ${stored.imageId}::uuid, ${stored.url}, ${kinds[item.kind].alt(item.author)},
        ${stored.image.placeholder}, ${stored.image.width}::integer,
        ${stored.image.height}::integer, now(), now()
      from target
      returning id
    )
    update ${eventPostsTable}
    set ${column} = image.id, updated_at = now()
    from image
    where ${eventPostsTable.id} = ${item.id}
    returning ${eventPostsTable.id}
  `);
  return result.rows.length > 0;
}

/**
 * `work`, or a rejection once `signal` aborts, whichever comes first, so
 * a step that can't be cancelled (such as processing an image) still can't
 * hold a run past its bound. What it leaves running is abandoned.
 */
export function untilAborted<A>(
  work: Promise<A>,
  signal: AbortSignal,
): Promise<A> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<A>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    work
      .finally(() => signal.removeEventListener("abort", abort))
      .then(resolve, (error: unknown) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
  });
}

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error("Aborted");

/** How often the hourly sync runs: each run starts the queue further on. */
const runEveryMs = 3_600_000;

/**
 * `items` from where this run starts: oldest first, but each hourly run
 * starts `maxItems` further on, wrapping around. Without it, images that
 * keep failing would fill every run and the ones after them never come up.
 */
export function rotate<A>(
  items: ReadonlyArray<A>,
  now: number,
  maxItems: number,
): ReadonlyArray<A> {
  if (items.length <= maxItems) return items;
  const start = (Math.floor(now / runEveryMs) * maxItems) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * Copies post images still missing: at most `maxItems` of them (each run
 * starting further along the queue, see `rotate`), none started after
 * `budgetMs`, each given `itemTimeoutMs`, processing included, before it
 * is skipped and left for a later run. `remaining` counts what is still
 * missing afterwards, failures included, so the summary says when a
 * backlog remains.
 */
export async function ingestPostImages(
  deps: PostImageDependencies,
  {
    budgetMs = 20_000,
    signal = new AbortController().signal,
    maxItems = maxImagesPerRun,
    itemTimeoutMs = imageTimeoutMs,
  }: {
    budgetMs?: number;
    signal?: AbortSignal;
    maxItems?: number;
    itemTimeoutMs?: number;
  } = {},
): Promise<PostImageResult> {
  const deadline = deps.now() + budgetMs;
  const items = await missing(deps.database);
  const result: PostImageResult = {
    ingested: [],
    failed: [],
    remaining: items.length,
  };
  for (const [index, item] of rotate(items, deps.now(), maxItems).entries()) {
    if (index >= maxItems || deps.now() >= deadline || signal.aborted) break;
    const itemSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(itemTimeoutMs),
    ]);
    let unusedKey: string | null = null;
    try {
      const image = await untilAborted(
        deps.download(item.source, { signal: itemSignal }).then(deps.process),
        itemSignal,
      );
      const imageId = deps.newId();
      const key = postImageKey(item.id, item.kind, imageId, image.format);
      const url = await deps.store(key, image, { signal: itemSignal });
      unusedKey = key;
      itemSignal.throwIfAborted();
      const saved = await saveImage(deps.database, item, {
        imageId,
        url,
        image,
      });
      // Saved, or set meanwhile by someone else: either way, no longer missing.
      result.remaining -= 1;
      if (saved) {
        unusedKey = null;
        result.ingested.push(key);
      }
    } catch (error) {
      result.failed.push({ url: item.source, error: errorMessage(error) });
    }
    if (unusedKey) {
      const key = unusedKey;
      await deps.remove(key).catch((error: unknown) => {
        result.failed.push({
          url: item.source,
          error: `Could not delete unused image ${key}: ${errorMessage(error)}`,
        });
      });
    }
  }
  return result;
}
