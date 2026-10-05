import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql/SqlClient";
import { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { CoverSource } from "./covers.ts";
import { MediaBucket, maxMediaBytes } from "./media-bucket.ts";
import { Pictures, processForStorage, type StoredImage } from "./pictures.ts";
import {
  coverHosts,
  downloadImage,
  postImageHosts,
  profilePhotoHosts,
} from "./remote.ts";

/**
 * The hourly sync's image ingestion, as the app does it (app/src/lib/
 * event-covers, profile-photos, post-images): each event without a cover
 * gets its Luma cover, each profile without a photo the one at its
 * `photo_source_url`, and each post its image and author's avatar. The image
 * is downloaded, processed (`Pictures`), stored in the media bucket under a
 * new key, and then, in one statement, recorded in `images` and set on its
 * row, only while the row still has none.
 *
 * - Images set meanwhile, by an organizer or another run, are never
 *   replaced: the statement claims the row with FOR UPDATE and finds it
 *   taken, and the object stored for nothing is deleted again.
 * - One item's failure never stops the others; each is reported.
 * - Each phase starts no new item after its budget, so a run is bounded;
 *   what is left is picked up by the next run. Nothing is ever deleted
 *   from `images` or the rows.
 *
 * The statements are the app's, so site_sync's grants
 * (infra/scripts/site-sync.ts) cover both; tests/ingest-parity.test.ts runs
 * each phase and the app's on copies of one database and requires the same
 * rows.
 */

/** A new image's id: random, or fixed in tests. */
export class NewImageId extends Context.Reference<() => string>(
  "allthings/NewImageId",
  { defaultValue: () => () => crypto.randomUUID() },
) {}

export interface CoverResult {
  readonly ingested: ReadonlyArray<string>;
  /** Events Luma shows no cover for. */
  readonly withoutCover: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{
    readonly slug: string;
    readonly error: string;
  }>;
}

export interface PhotoResult {
  readonly ingested: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{
    readonly name: string;
    readonly error: string;
  }>;
}

export interface PostImageResult {
  /** The stored keys. */
  readonly ingested: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{
    readonly url: string;
    readonly error: string;
  }>;
  /** Images still to copy when the run stopped: the next run takes them. */
  readonly remaining: number;
}

/** What a run would ingest, read without downloading or writing anything. */
export interface PendingImages {
  readonly covers: ReadonlyArray<{
    readonly slug: string;
    readonly lumaEventId: string;
  }>;
  readonly photos: ReadonlyArray<{
    readonly name: string;
    readonly source: string;
  }>;
  readonly posts: ReadonlyArray<{
    readonly postId: string;
    readonly kind: PostImageKind;
    readonly source: string;
  }>;
}

/** The most post images one run copies, whatever time is left. */
export const maxPostImagesPerRun = 40;

/** How long one post image may take, download to storage, before it is skipped. */
export const postImageTimeout = Duration.seconds(8);

/** A cover the database says is still missing. */
const MissingCover = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  lumaEventId: Schema.String,
});
const MissingPhoto = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
});
const MissingPostImage = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  source: Schema.String,
});

/** The two images a post can carry. */
export type PostImageKind = "image" | "avatar";

const postKinds = {
  image: {
    source: "image_source_url",
    target: "image",
    alt: (author: string) => `Photo from ${author}'s post`,
  },
  avatar: {
    source: "author_avatar_source_url",
    target: "author_avatar",
    alt: (author: string) => author,
  },
} as const;

/** The bucket key for an event's cover. */
export const coverKey = (eventId: string, imageId: string, format: string) =>
  `events/${eventId}/cover-${imageId}.${format}`;

/**
 * The bucket key for a profile photo: the name reduced to letters, digits
 * and dashes (accents kept, as in "erik-peña").
 */
export function profilePhotoKey(name: string, imageId: string, format: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `profiles/${slug || "profile"}-${imageId}.${format}`;
}

/** The bucket key for one of a post's images. */
export const postImageKey = (
  postId: string,
  kind: PostImageKind,
  imageId: string,
  format: string,
) => `posts/${postId}-${kind}-${imageId}.${format}`;

const runEvery = Duration.hours(1);

/**
 * `items` from where this run starts: oldest first, but each hourly run
 * starts `maxItems` further on, wrapping around, so images that keep
 * failing can't fill every run.
 */
export function rotate<A>(
  items: ReadonlyArray<A>,
  nowMillis: number,
  maxItems: number,
): ReadonlyArray<A> {
  if (items.length <= maxItems) return items;
  const start =
    (Math.floor(nowMillis / Duration.toMillis(runEvery)) * maxItems) %
    items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface ImageIngestShape {
  /** Covers for events without one, newest events first, starting none after `budget`. */
  readonly covers: (options: {
    readonly budget: Duration.Input;
  }) => Effect.Effect<CoverResult, DataSourceError>;
  /** Photos for profiles without one, oldest profiles first. */
  readonly profilePhotos: (options: {
    readonly budget: Duration.Input;
  }) => Effect.Effect<PhotoResult, DataSourceError>;
  /** Post images and avatars, at most `maxItems` (40), each given `itemTimeout` (8 s). */
  readonly postImages: (options: {
    readonly budget: Duration.Input;
    readonly maxItems?: number;
    readonly itemTimeout?: Duration.Input;
  }) => Effect.Effect<PostImageResult, DataSourceError>;
  /** The dry run: what the phases would ingest now, in their order. */
  readonly pending: Effect.Effect<PendingImages, DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const bucket = yield* MediaBucket;
  const coverSource = yield* CoverSource;
  const context = yield* Effect.context<HttpClient.HttpClient | Pictures>();

  /** Downloads and processes an image, with the Worker's own services. */
  const fetchImage = (url: string, hosts: ReadonlySet<string>) =>
    downloadImage(url, hosts).pipe(
      Effect.flatMap(processForStorage),
      Effect.provideContext(context),
    );

  /** Stores an image under `key`, refusing one too large for the site's variants. */
  const store = (key: string, image: StoredImage) =>
    image.bytes.byteLength > maxMediaBytes
      ? Effect.fail(
          new Error(
            `${key} is ${image.bytes.byteLength} bytes, over the ${maxMediaBytes} an image may be`,
          ),
        )
      : bucket.put(key, image.bytes, `image/${image.format}`);

  /**
   * Records `image` and sets it on `table`.`column` of row `id`, in one
   * statement, only while that column is still empty; whether it did.
   */
  const save = (
    target: {
      readonly table: "events" | "profiles" | "event_posts";
      readonly column: "preview_image" | "image" | "author_avatar";
      readonly id: string;
      /** Never wait on another run's lock: fail, and try next run. */
      readonly nowait?: boolean;
    },
    image: {
      readonly imageId: string;
      readonly url: string;
      readonly alt: string;
      readonly stored: StoredImage;
    },
  ) => {
    const table = sql.literal(target.table);
    const column = sql.literal(target.column);
    const lock = sql.literal(
      target.nowait === true ? "for update nowait" : "for update",
    );
    return sql<{ id: string }>`
      with target as (
        select ${table}.id from ${table}
        where ${table}.id = ${target.id} and ${column} is null
        ${lock}
      ), image as (
        insert into images
          (id, url, alt, placeholder, width, height, created_at, updated_at)
        select ${image.imageId}::uuid, ${image.url}, ${image.alt},
          ${image.stored.placeholder}, ${image.stored.width}::integer,
          ${image.stored.height}::integer, now(), now()
        from target
        returning id
      )
      update ${table}
      set ${column} = image.id, updated_at = now()
      from image
      where ${table}.id = ${target.id}
      returning ${table}.id`.pipe(Effect.map((rows) => rows.length > 0));
  };

  /**
   * One image, end to end: fetch, store under the key `keyOf` makes, save.
   * Whether it was saved; an object stored but not saved (the row was taken
   * meanwhile, saving failed, or the item ran out of time) is deleted again,
   * and a failed delete is reported through `onUnused`.
   */
  const ingestOne = (options: {
    readonly source: string;
    readonly hosts: ReadonlySet<string>;
    readonly keyOf: (imageId: string, format: string) => string;
    readonly save: (image: {
      readonly imageId: string;
      readonly url: string;
      readonly stored: StoredImage;
    }) => Effect.Effect<boolean, unknown>;
    readonly onUnused: (key: string, error: unknown) => Effect.Effect<void>;
    readonly fetchTimeout?: Duration.Input;
  }) =>
    Effect.gen(function* () {
      const newId = yield* NewImageId;
      const fetched = fetchImage(options.source, options.hosts);
      const stored = yield* options.fetchTimeout === undefined
        ? fetched
        : fetched.pipe(Effect.timeout(options.fetchTimeout));
      const imageId = newId();
      const key = options.keyOf(imageId, stored.format);
      return yield* Effect.acquireUseRelease(
        store(key, stored),
        (url) => options.save({ imageId, url, stored }),
        (_url, exit) =>
          Exit.isSuccess(exit) && exit.value
            ? Effect.void
            : bucket.remove(key).pipe(
                Effect.timeout(Duration.seconds(5)),
                Effect.catch((error) => options.onUnused(key, error)),
              ),
      );
    });

  const before = (deadline: number) =>
    Effect.map(Clock.currentTimeMillis, (now) => now < deadline);

  const missingCovers = sql`
    select id, slug, name, luma_event_id as "lumaEventId"
    from events
    where preview_image is null and luma_event_id is not null
    order by start_date desc`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MissingCover))),
    orDataSourceError,
  );

  const missingPhotos = sql`
    select id, name, photo_source_url as source
    from profiles
    where image is null and photo_source_url <> ''
    order by created_at asc`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MissingPhoto))),
    orDataSourceError,
  );

  /** Post images still to copy, oldest posts first, avatars after photos. */
  const missingPostImages = Effect.forEach(
    ["image", "avatar"] as const,
    (kind) => {
      const { source, target } = postKinds[kind];
      return sql`
        select id, author_name as author, ${sql.literal(source)} as source
        from event_posts
        where ${sql.literal(target)} is null
          and coalesce(${sql.literal(source)}, '') <> ''
        order by added_at, id`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Array(MissingPostImage)),
        ),
        Effect.map((rows) => rows.map((row) => ({ ...row, kind }))),
      );
    },
  ).pipe(
    Effect.map((kinds) => kinds.flat()),
    orDataSourceError,
  );

  const covers: ImageIngestShape["covers"] = ({ budget }) =>
    Effect.gen(function* () {
      const result = {
        ingested: [] as string[],
        withoutCover: [] as string[],
        failed: [] as Array<{ slug: string; error: string }>,
      };
      const find = Option.getOrUndefined(coverSource.find);
      if (find === undefined) return result;
      const deadline =
        (yield* Clock.currentTimeMillis) + Duration.toMillis(budget);
      for (const event of yield* missingCovers) {
        if (!(yield* before(deadline))) break;
        const fail = (error: unknown) =>
          Effect.sync(() => {
            result.failed.push({ slug: event.slug, error: messageOf(error) });
          });
        yield* Effect.gen(function* () {
          const coverUrl = yield* find(event.lumaEventId);
          if (coverUrl === null) {
            result.withoutCover.push(event.slug);
            return;
          }
          const saved = yield* ingestOne({
            source: coverUrl,
            hosts: coverHosts,
            keyOf: (imageId, format) => coverKey(event.id, imageId, format),
            save: ({ imageId, url, stored }) =>
              save(
                { table: "events", column: "preview_image", id: event.id },
                { imageId, url, alt: `${event.name} event cover`, stored },
              ),
            onUnused: (key, error) =>
              fail(`Could not delete unused cover ${key}: ${messageOf(error)}`),
          });
          if (saved) result.ingested.push(event.slug);
        }).pipe(Effect.catch(fail));
      }
      return result;
    }).pipe(Effect.withSpan("ImageIngest.covers"));

  const profilePhotos: ImageIngestShape["profilePhotos"] = ({ budget }) =>
    Effect.gen(function* () {
      const result = {
        ingested: [] as string[],
        failed: [] as Array<{ name: string; error: string }>,
      };
      const deadline =
        (yield* Clock.currentTimeMillis) + Duration.toMillis(budget);
      for (const profile of yield* missingPhotos) {
        if (!(yield* before(deadline))) break;
        const fail = (error: unknown) =>
          Effect.sync(() => {
            result.failed.push({ name: profile.name, error: messageOf(error) });
          });
        yield* ingestOne({
          source: profile.source,
          hosts: profilePhotoHosts,
          keyOf: (imageId, format) =>
            profilePhotoKey(profile.name, imageId, format),
          save: ({ imageId, url, stored }) =>
            save(
              { table: "profiles", column: "image", id: profile.id },
              { imageId, url, alt: profile.name, stored },
            ),
          onUnused: (key, error) =>
            fail(`Could not delete unused photo ${key}: ${messageOf(error)}`),
        }).pipe(
          Effect.flatMap((saved) =>
            Effect.sync(() => {
              if (saved) result.ingested.push(profile.name);
            }),
          ),
          Effect.catch(fail),
        );
      }
      return result;
    }).pipe(Effect.withSpan("ImageIngest.profilePhotos"));

  const postImages: ImageIngestShape["postImages"] = ({
    budget,
    maxItems = maxPostImagesPerRun,
    itemTimeout = postImageTimeout,
  }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const deadline = now + Duration.toMillis(budget);
      const items = yield* missingPostImages;
      const result = {
        ingested: [] as string[],
        failed: [] as Array<{ url: string; error: string }>,
        remaining: items.length,
      };
      for (const [index, item] of rotate(items, now, maxItems).entries()) {
        if (index >= maxItems || !(yield* before(deadline))) break;
        const fail = (error: unknown) =>
          Effect.sync(() => {
            result.failed.push({ url: item.source, error: messageOf(error) });
          });
        let stored: string | undefined;
        yield* ingestOne({
          source: item.source,
          hosts: postImageHosts,
          fetchTimeout: itemTimeout,
          keyOf: (imageId, format) => {
            stored = postImageKey(item.id, item.kind, imageId, format);
            return stored;
          },
          save: ({ imageId, url, stored: image }) =>
            save(
              {
                table: "event_posts",
                column: postKinds[item.kind].target,
                id: item.id,
                nowait: true,
              },
              {
                imageId,
                url,
                alt: postKinds[item.kind].alt(item.author),
                stored: image,
              },
            ).pipe(
              // Saved, or set meanwhile by someone else: no longer missing.
              Effect.tap(() =>
                Effect.sync(() => {
                  result.remaining -= 1;
                }),
              ),
            ),
          onUnused: (key, error) =>
            fail(`Could not delete unused image ${key}: ${messageOf(error)}`),
        }).pipe(
          Effect.flatMap((saved) =>
            Effect.sync(() => {
              if (saved && stored !== undefined) result.ingested.push(stored);
            }),
          ),
          Effect.catch(fail),
        );
      }
      return result;
    }).pipe(Effect.withSpan("ImageIngest.postImages"));

  const pending: ImageIngestShape["pending"] = Effect.gen(function* () {
    const [missing, photos, posts] = yield* Effect.all([
      Option.isSome(coverSource.find) ? missingCovers : Effect.succeed([]),
      missingPhotos,
      missingPostImages,
    ]);
    return {
      covers: missing.map(({ slug, lumaEventId }) => ({ slug, lumaEventId })),
      photos: photos.map(({ name, source }) => ({ name, source })),
      posts: posts.map(({ id, kind, source }) => ({
        postId: id,
        kind,
        source,
      })),
    };
  }).pipe(Effect.withSpan("ImageIngest.pending"));

  return ImageIngest.of({ covers, profilePhotos, postImages, pending });
});

export class ImageIngest extends Context.Service<
  ImageIngest,
  ImageIngestShape
>()("allthings/ImageIngest") {
  /**
   * Needs a `SqlClient`, the `MediaBucket`, a `CoverSource`, `Pictures` and
   * an `HttpClient` for downloads (`FetchHttpClient.layer` in a Worker).
   */
  static readonly layer = Layer.effect(ImageIngest, make);
}
