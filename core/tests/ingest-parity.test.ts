import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import type { DataSourceError } from "../src/errors.ts";
import { ImageIngest, NewImageId } from "../src/ingest/ingest.ts";
import { processForStorage } from "../src/ingest/pictures.ts";
import {
  coverHosts,
  downloadImage,
  postImageHosts,
  profilePhotoHosts,
} from "../src/ingest/remote.ts";
import { clockAt, migratedDatabase, sqlLayer } from "./support/database.ts";
import {
  fakeBucket,
  fakeCovers,
  fakeHosts,
  fakePictures,
  imageBytes,
  sequentialIds,
} from "./support/ingest.ts";
import { fixture } from "./support/luma.ts";

/**
 * Runs the app's three image ingestions (app/src/lib/event-covers,
 * profile-photos, post-images) and core's ImageIngest on two copies of one
 * database, with the same images to download, the same processing, the same
 * new ids and the same time, and requires the same database afterwards, row
 * for row, the same objects stored and deleted, and the same results.
 *
 * Downloading and processing are core's on both sides (the app's use sharp
 * and the network), given to the app as its injected dependencies: what is
 * compared is everything around them, which rows are picked, in what order,
 * under what key, and what each statement writes.
 */

const app = new URL("../../app/", import.meta.url);
const load = (path: string): Promise<unknown> =>
  import(new URL(path, app).href);
const { drizzle } = (await import(
  Bun.resolveSync("drizzle-orm/pglite", app.pathname)
)) as { drizzle: (config: { client: unknown }) => unknown };

type AppResult = Record<string, unknown>;
type AppIngest = (
  deps: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<AppResult>;
const { ingestMissingCovers } = (await load(
  "src/lib/event-covers/ingest.ts",
)) as { ingestMissingCovers: AppIngest };
const { ingestProfilePhotos } = (await load(
  "src/lib/profile-photos/ingest.ts",
)) as { ingestProfilePhotos: AppIngest };
const { ingestPostImages } = (await load("src/lib/post-images/ingest.ts")) as {
  ingestPostImages: AppIngest;
};

const stored = await fixture("stored.sql");
const at = DateTime.makeUnsafe("2026-10-05T12:00:00Z");

/** Profiles and posts with images to fetch, beside tests/fixtures/luma/stored.sql. */
const seed = `${stored}
  UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1'
  WHERE id = 'b0000000-0000-4000-8000-000000000001';
  INSERT INTO profiles (id, name, title, bio, profile_type, photo_source_url, created_at, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000002', 'Grace Hopper', '', '', 'member', 'https://pbs.twimg.com/profile_images/2/grace.webp', '2024-06-03T00:00:00Z', '2024-06-03T00:00:00Z'),
    ('b0000000-0000-4000-8000-000000000003', 'Erik Peña', '', '', 'member', 'https://media.licdn.com/missing.jpg', '2024-06-04T00:00:00Z', '2024-06-04T00:00:00Z'),
    ('b0000000-0000-4000-8000-000000000004', 'Linus', '', '', 'member', 'https://example.com/linus.png', '2024-06-05T00:00:00Z', '2024-06-05T00:00:00Z'),
    ('b0000000-0000-4000-8000-000000000005', 'Has one', '', '', 'member', 'https://pbs.twimg.com/has.png', '2024-06-06T00:00:00Z', '2024-06-06T00:00:00Z'),
    ('b0000000-0000-4000-8000-000000000006', 'Empty source', '', '', 'member', '', '2024-06-07T00:00:00Z', '2024-06-07T00:00:00Z');
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000002'
  WHERE id = 'b0000000-0000-4000-8000-000000000005';
  INSERT INTO event_posts (id, event_id, platform, url, author_name, author_avatar_source_url, posted_at, text, image_source_url, added_at, updated_at) VALUES
    ('70000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/a/status/1', 'Ada', 'https://pbs.twimg.com/profile_images/1/ada.jpg', '2024-07-30T02:00:00Z', 'What a night', 'https://pbs.twimg.com/media/1.jpg', '2024-07-30T03:00:00Z', '2024-07-30T03:00:00Z'),
    ('70000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/p/2', 'Grace', 'https://cdn.bsky.app/avatar/grace.jpg', '2024-07-30T04:00:00Z', 'Great talks', NULL, '2024-07-30T05:00:00Z', '2024-07-30T05:00:00Z'),
    ('70000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'linkedin', 'https://linkedin.com/p/3', 'Linus', NULL, '2024-07-30T06:00:00Z', 'Slides', 'https://media.licdn.com/gone.png', '2024-07-30T07:00:00Z', '2024-07-30T07:00:00Z');
`;

/** What every URL answers: images, a redirect, a 404 and a non-image. */
const hosts = {
  "https://avatars.githubusercontent.com/u/1": imageBytes("png", "ada"),
  "https://pbs.twimg.com/profile_images/2/grace.webp": imageBytes(
    "webp",
    "grace",
  ),
  "https://pbs.twimg.com/profile_images/1/ada.jpg": imageBytes(
    "jpeg",
    "ada-avatar",
  ),
  "https://pbs.twimg.com/media/1.jpg":
    "https://pbs.twimg.com/media/1-large.jpg",
  "https://pbs.twimg.com/media/1-large.jpg": imageBytes("jpeg", "night"),
  "https://cdn.bsky.app/avatar/grace.jpg": imageBytes("gif", "grace-avatar"),
  "https://media.licdn.com/gone.png": 404,
  "https://images.lumacdn.com/cover-a.png": imageBytes("png", "cover-a"),
  "https://images.lumacdn.com/cover-b.avif": imageBytes("avif", "cover-b"),
  "https://images.lumacdn.com/text.txt": new TextEncoder().encode(
    "not an image",
  ),
};

/** Each event without a cover, newest first, gets one of these in turn. */
const coverAnswers = [
  "https://images.lumacdn.com/cover-a.png",
  null,
  new Error(
    "Luma API: Luma event 500; public event data: Luma public event 500",
  ),
  "https://images.lumacdn.com/cover-b.avif",
  "https://images.lumacdn.com/text.txt",
  "https://evil.example.com/cover.png",
] as const;

/** Every row of every table in `public`, in a stable order. */
async function contents(db: PGlite) {
  const tables = await db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const result: Record<string, Array<string>> = {};
  for (const { name } of tables.rows) {
    const rows = await db.query<{ row: string }>(
      `SELECT to_jsonb(t)::text AS row FROM public.${name} t`,
    );
    result[name] = rows.rows.map(({ row }) => row).toSorted();
  }
  return result;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});

type Phase = "covers" | "photos" | "posts";

interface Side {
  readonly result: AppResult;
  readonly put: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/** Runs one phase on both sides, from the same database, and compares. */
async function parity(
  phase: Phase,
  options: {
    readonly maxItems?: number;
    /** Runs as an object is stored, on that side's database. */
    readonly beforeStore?: (db: PGlite, key: string) => Promise<void>;
  } = {},
) {
  const [appDb, coreDb] = await Promise.all([
    migratedDatabase(),
    migratedDatabase(),
  ]);
  try {
    await Promise.all([appDb.exec(seed), coreDb.exec(seed)]);
    const missing = await appDb.query<{ luma_event_id: string }>(
      `SELECT luma_event_id FROM events
       WHERE preview_image IS NULL AND luma_event_id IS NOT NULL
       ORDER BY start_date DESC`,
    );
    const covers = Object.fromEntries(
      missing.rows.map(({ luma_event_id }, index) => [
        luma_event_id,
        coverAnswers[index % coverAnswers.length] ?? null,
      ]),
    );
    const hostsOf = {
      covers: coverHosts,
      photos: profilePhotoHosts,
      posts: postImageHosts,
    }[phase];

    const runApp = async (): Promise<Side> => {
      const fake = fakeHosts(hosts);
      const bucket = fakeBucket(
        (key) => options.beforeStore?.(appDb, key) ?? Promise.resolve(),
      );
      const deps = {
        database: drizzle({ client: appDb }),
        findCoverUrl: async ({ lumaEventId }: { lumaEventId: string }) => {
          const cover = covers[lumaEventId];
          if (cover instanceof Error) throw cover;
          return cover ?? null;
        },
        download: (url: string) =>
          Effect.runPromise(
            downloadImage(url, hostsOf).pipe(Effect.provide(fake.layer)),
          ),
        process: (bytes: Uint8Array) =>
          Effect.runPromise(
            processForStorage(bytes).pipe(Effect.provide(fakePictures)),
          ),
        store: (key: string, image: { bytes: Uint8Array; format: string }) =>
          bucket.store(key, image.bytes, `image/${image.format}`),
        remove: async (key: string) => {
          bucket.log.removed.push(key);
        },
        newId: sequentialIds(),
        now: Date.now,
      };
      setSystemTime(DateTime.toDateUtc(at));
      try {
        const result =
          phase === "covers"
            ? await ingestMissingCovers(deps)
            : phase === "photos"
              ? await ingestProfilePhotos(deps)
              : await ingestPostImages(
                  deps,
                  options.maxItems === undefined
                    ? {}
                    : { maxItems: options.maxItems },
                );
        return {
          result,
          put: bucket.log.put.map(({ key }) => key),
          removed: bucket.log.removed,
        };
      } finally {
        setSystemTime();
      }
    };

    const runCore = async (): Promise<Side> => {
      const fake = fakeHosts(hosts);
      const bucket = fakeBucket(
        (key) => options.beforeStore?.(coreDb, key) ?? Promise.resolve(),
      );
      const layer = ImageIngest.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            bucket.layer,
            fakeCovers(covers),
            fakePictures,
            fake.layer,
          ),
        ),
        Layer.provideMerge(sqlLayer(coreDb)),
        Layer.provideMerge(clockAt(at)),
        Layer.provideMerge(Layer.succeed(NewImageId, sequentialIds())),
      );
      setSystemTime(DateTime.toDateUtc(at));
      try {
        const result = await Effect.runPromise(
          ImageIngest.use(
            (ingest): Effect.Effect<unknown, DataSourceError> =>
              phase === "covers"
                ? ingest.covers({ budget: "40 seconds" })
                : phase === "photos"
                  ? ingest.profilePhotos({ budget: "20 seconds" })
                  : ingest.postImages({
                      budget: "20 seconds",
                      ...(options.maxItems === undefined
                        ? {}
                        : { maxItems: options.maxItems }),
                    }),
          ).pipe(Effect.provide(layer)),
        );
        return {
          result: result as AppResult,
          put: bucket.log.put.map(({ key }) => key),
          removed: bucket.log.removed,
        };
      } finally {
        setSystemTime();
      }
    };

    const appSide = await runApp();
    const coreSide = await runCore();
    expect(await contents(coreDb)).toEqual(await contents(appDb));
    expect(coreSide.put).toEqual(appSide.put);
    expect(coreSide.removed).toEqual(appSide.removed);
    // The same items succeed, fail and are skipped; messages may differ.
    const keys = (result: AppResult) =>
      Object.fromEntries(
        Object.entries(result).map(([name, value]) => [
          name,
          Array.isArray(value)
            ? value.map((entry: unknown) =>
                typeof entry === "object" && entry !== null
                  ? Object.values(entry)[0]
                  : entry,
              )
            : value,
        ]),
      );
    expect(keys(coreSide.result)).toEqual(keys(appSide.result));
    return { app: appSide, core: coreSide, db: coreDb };
  } finally {
    await Promise.all([appDb.close(), coreDb.close()]);
  }
}

describe("image ingestion matches the app's", () => {
  test("covers: stored, missing on Luma, failing, converted and refused", async () => {
    const { core } = await parity("covers");
    expect(core.result).toMatchObject({
      ingested: expect.arrayContaining([expect.any(String)]),
      withoutCover: expect.arrayContaining([expect.any(String)]),
    });
    expect(core.put.some((key) => key.endsWith(".jpeg"))).toBe(true);
    expect((core.result["failed"] as unknown[]).length).toBeGreaterThan(0);
  });

  test("profile photos: stored, converted, missing, refused hosts, and photos already set", async () => {
    const { core } = await parity("photos");
    expect(core.result["ingested"]).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(core.put).toEqual([
      "profiles/ada-lovelace-90000000-0000-4000-8000-000000000001.png",
      "profiles/grace-hopper-90000000-0000-4000-8000-000000000002.jpeg",
    ]);
    expect(
      (core.result["failed"] as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).toEqual(["Erik Peña", "Linus"]);
  });

  test("post images: photos then avatars, redirects followed, one gone", async () => {
    const { core } = await parity("posts");
    expect(core.result).toMatchObject({ remaining: 1 });
    expect(core.put).toEqual([
      "posts/70000000-0000-4000-8000-000000000001-image-90000000-0000-4000-8000-000000000001.jpeg",
      "posts/70000000-0000-4000-8000-000000000001-avatar-90000000-0000-4000-8000-000000000002.jpeg",
      "posts/70000000-0000-4000-8000-000000000002-avatar-90000000-0000-4000-8000-000000000003.gif",
    ]);
  });

  test("post images: a run takes at most its share, rotating through the queue", async () => {
    const { core } = await parity("posts", { maxItems: 2 });
    // Of the four images missing, two are tried: one stored, one gone.
    expect(
      (core.result["ingested"] as unknown[]).length +
        (core.result["failed"] as unknown[]).length,
    ).toBe(2);
  });

  test("an image set meanwhile is kept, and the one stored for nothing deleted", async () => {
    const { core } = await parity("photos", {
      beforeStore: async (db, key) => {
        if (key.startsWith("profiles/ada-lovelace")) {
          await db.exec(
            `UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000001'
             WHERE id = 'b0000000-0000-4000-8000-000000000001'`,
          );
        }
      },
    });
    expect(core.result["ingested"]).toEqual(["Grace Hopper"]);
    expect(core.removed).toEqual([
      "profiles/ada-lovelace-90000000-0000-4000-8000-000000000001.png",
    ]);
  });
});
