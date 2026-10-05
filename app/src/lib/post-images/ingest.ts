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
 * Copies post images still missing, oldest first: at most `maxItems` of
 * them, none started after `budgetMs`, each given `itemTimeoutMs` before
 * it is skipped (a skipped image is tried again next run). What is left is
 * counted, so the run's summary says when a backlog remains.
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
  for (const [index, item] of items.entries()) {
    if (index >= maxItems || deps.now() >= deadline || signal.aborted) break;
    result.remaining -= 1;
    const itemSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(itemTimeoutMs),
    ]);
    let unusedKey: string | null = null;
    try {
      const image = await deps.process(
        await deps.download(item.source, { signal: itemSignal }),
      );
      const imageId = deps.newId();
      const key = postImageKey(item.id, item.kind, imageId, image.format);
      const url = await deps.store(key, image, { signal: itemSignal });
      unusedKey = key;
      itemSignal.throwIfAborted();
      if (await saveImage(deps.database, item, { imageId, url, image })) {
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
