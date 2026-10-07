import { describe, expect, test } from "bun:test";
import { DateTime, Effect, Exit, Layer, Option } from "effect";
import { CoverSource, type CoverSourceShape } from "../src/ingest/covers.ts";
import { ImageIngest, rotate } from "../src/ingest/ingest.ts";
import { processForStorage } from "../src/ingest/pictures.ts";
import {
  coverHosts,
  downloadImage,
  maxImageBytes,
  postImageHosts,
  profilePhotoHosts,
} from "../src/ingest/remote.ts";
import { looksLikeImage } from "../src/ingest/signature.ts";
import { clockAt, migratedDatabase, sqlLayer } from "./support/database.ts";
import {
  fakeBucket,
  fakeCovers,
  fakeHosts,
  fakePictures,
  imageBytes,
} from "./support/ingest.ts";
import { configFrom, fakeLumaBy, fixture, settle } from "./support/luma.ts";

const download = (url: string, answers: Parameters<typeof fakeHosts>[0]) => {
  const hosts = fakeHosts(answers);
  return Effect.runPromiseExit(
    downloadImage(url, profilePhotoHosts).pipe(Effect.provide(hosts.layer)),
  ).then((exit) => ({ exit, asked: hosts.asked }));
};

const failure = (exit: Exit.Exit<unknown, { message: string }>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error.message
    : undefined;

describe("downloading an image", () => {
  const photo = imageBytes("png", "ada");

  test("follows redirects on allowed hosts", async () => {
    const { exit, asked } = await download("https://pbs.twimg.com/a.png", {
      "https://pbs.twimg.com/a.png": "/b.png",
      "https://pbs.twimg.com/b.png": photo,
    });
    expect(Exit.isSuccess(exit) && exit.value).toEqual(photo);
    expect(asked).toEqual([
      "https://pbs.twimg.com/a.png",
      "https://pbs.twimg.com/b.png",
    ]);
  });

  test("never asks a host off the list, even through a redirect", async () => {
    const off = await download("https://example.com/a.png", {});
    expect(failure(off.exit)).toBe(
      "URL is not on an allowed host: https://example.com",
    );
    expect(off.asked).toEqual([]);
    const redirected = await download("https://pbs.twimg.com/a.png", {
      "https://pbs.twimg.com/a.png": "https://example.com/b.png",
    });
    expect(failure(redirected.exit)).toBe(
      "URL is not on an allowed host: https://example.com",
    );
    expect(redirected.asked).toEqual(["https://pbs.twimg.com/a.png"]);
    expect(
      failure((await download("http://pbs.twimg.com/a.png", {})).exit),
    ).toBe("URL is not on an allowed host: http://pbs.twimg.com");
  });

  test("fails an item, not the run, on a redirect to no URL", async () => {
    const { exit } = await download("https://pbs.twimg.com/a", {
      "https://pbs.twimg.com/a": "http://[",
    });
    expect(failure(exit)).toBe("Redirect location is not a URL");
  });

  test("takes HEIC, which is stored as JPEG", async () => {
    const heic = imageBytes("heic", "phone");
    const { exit } = await download("https://pbs.twimg.com/a.heic", {
      "https://pbs.twimg.com/a.heic": heic,
    });
    expect(Exit.isSuccess(exit) && exit.value).toEqual(heic);
  });

  test("gives up after three redirects", async () => {
    const { exit, asked } = await download("https://pbs.twimg.com/0", {
      "https://pbs.twimg.com/0": "/1",
      "https://pbs.twimg.com/1": "/2",
      "https://pbs.twimg.com/2": "/3",
      "https://pbs.twimg.com/3": "/4",
    });
    expect(failure(exit)).toBe("Redirected too many times");
    expect(asked).toHaveLength(4);
  });

  test("refuses failures, oversized bodies and anything not an image", async () => {
    expect(
      failure(
        (
          await download("https://pbs.twimg.com/a", {
            "https://pbs.twimg.com/a": 404,
          })
        ).exit,
      ),
    ).toBe("Image download failed: 404");
    const huge = new Uint8Array(maxImageBytes + 1);
    huge.set(photo);
    expect(
      failure(
        (
          await download("https://pbs.twimg.com/a", {
            "https://pbs.twimg.com/a": huge,
          })
        ).exit,
      ),
    ).toBe("Image is larger than 15 MB");
    expect(
      failure(
        (
          await download("https://pbs.twimg.com/a", {
            "https://pbs.twimg.com/a": new TextEncoder().encode("<html>"),
          })
        ).exit,
      ),
    ).toBe("Not a PNG, JPEG, GIF, WebP, AVIF or HEIC image");
  });
});

describe("processing an image", () => {
  const process = (bytes: Uint8Array) =>
    Effect.runPromise(
      processForStorage(bytes).pipe(Effect.provide(fakePictures)),
    );

  test("keeps PNG, JPEG and GIF as they are", async () => {
    for (const format of ["png", "jpeg", "gif"] as const) {
      const bytes = imageBytes(format, "x");
      const stored = await process(bytes);
      expect(stored.bytes).toBe(bytes);
      expect(stored.format).toBe(format);
    }
  });

  test("stores WebP, AVIF and HEIC as JPEG, measured after converting", async () => {
    for (const format of ["webp", "avif", "heic"] as const) {
      const stored = await process(imageBytes(format, "photo"));
      expect(stored).toMatchObject({ format: "jpeg", width: 500, height: 50 });
      expect(looksLikeImage(stored.bytes)).toBe(true);
      expect(stored.placeholder).toBe(
        `data:image/jpeg;base64,${btoa("jpeg:photo")}`,
      );
    }
  });
});

describe("rotate", () => {
  test("starts each hourly run further along the queue", () => {
    const items = [1, 2, 3, 4, 5];
    const hour = 3_600_000;
    expect(rotate(items, 0, 2)).toEqual([1, 2, 3, 4, 5]);
    expect(rotate(items, hour, 2)).toEqual([3, 4, 5, 1, 2]);
    expect(rotate(items, 2 * hour, 2)).toEqual([5, 1, 2, 3, 4]);
    expect(rotate([1, 2], hour, 2)).toEqual([1, 2]);
  });
});

describe("finding a cover on Luma", () => {
  const event = "evt-abc";
  const find = async (
    replies: Parameters<typeof fakeLumaBy>[1],
    env: Record<string, string> = { LUMA_API_KEY: "key" },
  ) => {
    const luma = fakeLumaBy((url) => url.hostname, replies);
    const source = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* CoverSource;
      }).pipe(
        Effect.provide(
          CoverSource.layer.pipe(
            Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
          ),
        ),
      ),
    );
    return { source, requests: luma.requests };
  };
  const run = (
    source: CoverSourceShape,
  ): Promise<Exit.Exit<string | null, { message: string }>> =>
    Option.match(source.find, {
      onNone: () => Promise.reject(new Error("no lookup")),
      onSome: (lookup) => Effect.runPromiseExit(lookup(event)),
    });

  test("asks Luma's API, with the key", async () => {
    const { source, requests } = await find({
      "public-api.luma.com": [
        {
          body: JSON.stringify({
            id: event,
            cover_url: "https://images.lumacdn.com/c.png",
          }),
        },
      ],
    });
    const exit = await run(source);
    expect(Exit.isSuccess(exit) && exit.value).toBe(
      "https://images.lumacdn.com/c.png",
    );
    expect(requests[0]).toMatchObject({
      url: `https://public-api.luma.com/v1/events/get?event_id=${event}`,
      apiKey: "key",
    });
  });

  test("falls back to the public event data when the API refuses", async () => {
    const { source, requests } = await find({
      "public-api.luma.com": [{ status: 403 }],
      "api.lu.ma": [{ body: JSON.stringify({ event: { cover_url: null } }) }],
    });
    const exit = await run(source);
    expect(Exit.isSuccess(exit) && exit.value).toBe(null);
    expect(requests[1]).toMatchObject({
      url: `https://api.lu.ma/event/get?event_api_id=${event}`,
    });
  });

  test("says why when neither answers", async () => {
    const { source } = await find({
      "public-api.luma.com": [{ status: 500 }],
      "api.lu.ma": [{ status: 502 }],
    });
    expect(failure(await run(source))).toBe(
      "Luma API: Luma event 500; public event data: Luma public event 502",
    );
  });

  test("looks nothing up without LUMA_API_KEY", async () => {
    const { source } = await find({}, {});
    expect(Option.isNone(source.find)).toBe(true);
  });
});

describe("the dry run", () => {
  test("lists what would be ingested, and writes and fetches nothing", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(await fixture("stored.sql"));
      await db.exec(
        `UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1'
         WHERE id = 'b0000000-0000-4000-8000-000000000001'`,
      );
      const hosts = fakeHosts({});
      const bucket = fakeBucket();
      const pending = await Effect.runPromise(
        ImageIngest.use((ingest) => ingest.pending).pipe(
          Effect.provide(
            ImageIngest.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  bucket.layer,
                  fakeCovers({}),
                  fakePictures,
                  hosts.layer,
                ),
              ),
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(
                clockAt(DateTime.makeUnsafe("2026-10-05T12:00:00Z")),
              ),
            ),
          ),
        ),
      );
      expect(pending.photos).toEqual([
        {
          name: "Ada Lovelace",
          source: "https://avatars.githubusercontent.com/u/1",
        },
      ]);
      expect(pending.covers.length).toBeGreaterThan(0);
      expect(pending.posts).toEqual([]);
      expect(hosts.asked).toEqual([]);
      expect(bucket.log.put).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe("a post image's time", () => {
  test("covers storing it too: a bucket that hangs fails the item, and the run goes on", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(await fixture("stored.sql"));
      await db.exec(
        `INSERT INTO event_posts (id, event_id, platform, url, author_name, posted_at, text, image_source_url, added_at, updated_at) VALUES
           ('70000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/1', 'Ada', now(), 't', 'https://pbs.twimg.com/1.jpg', '2024-01-01T00:00:00Z', now()),
           ('70000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/2', 'Grace', now(), 't', 'https://pbs.twimg.com/2.jpg', '2024-01-02T00:00:00Z', now())`,
      );
      const hosts = fakeHosts({
        "https://pbs.twimg.com/1.jpg": imageBytes("jpeg", "one"),
        "https://pbs.twimg.com/2.jpg": imageBytes("jpeg", "two"),
      });
      const bucket = fakeBucket((key) =>
        key.includes("-000000000001-")
          ? new Promise<void>(() => undefined)
          : Promise.resolve(),
      );
      const result = await Effect.runPromise(
        settle(
          ImageIngest.use((ingest) =>
            ingest.postImages({ budget: "1 minute", itemTimeout: "8 seconds" }),
          ),
        ).pipe(
          Effect.provide(
            ImageIngest.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  bucket.layer,
                  fakeCovers({}),
                  fakePictures,
                  hosts.layer,
                ),
              ),
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(
                clockAt(DateTime.makeUnsafe("2026-10-05T12:00:00Z")),
              ),
            ),
          ),
        ),
      );
      expect(result.failed.map(({ url }) => url)).toEqual([
        "https://pbs.twimg.com/1.jpg",
      ]);
      expect(result.ingested).toHaveLength(1);
      expect(result.ingested[0]).toContain(
        "70000000-0000-4000-8000-000000000002",
      );
    } finally {
      await db.close();
    }
  });
});

describe("a run's share", () => {
  test("covers and photos try at most maxItems each, oldest profiles and newest events first", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(await fixture("stored.sql"));
      await db.exec(
        `UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1'
         WHERE id = 'b0000000-0000-4000-8000-000000000001';
         INSERT INTO profiles (id, name, title, bio, profile_type, photo_source_url, created_at, updated_at) VALUES
           ('b0000000-0000-4000-8000-000000000002', 'Grace', '', '', 'member', 'https://avatars.githubusercontent.com/u/2', '2024-06-03T00:00:00Z', now())`,
      );
      const missing = await db.query<{ luma_event_id: string }>(
        "SELECT luma_event_id FROM events WHERE preview_image IS NULL AND luma_event_id IS NOT NULL",
      );
      const cover = "https://images.lumacdn.com/c.png";
      const bucket = fakeBucket();
      const [covers, photos] = await Effect.runPromise(
        ImageIngest.use((ingest) =>
          Effect.all([
            ingest.covers({ budget: "1 minute", maxItems: 1 }),
            ingest.profilePhotos({ budget: "1 minute", maxItems: 1 }),
          ]),
        ).pipe(
          Effect.provide(
            ImageIngest.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  bucket.layer,
                  fakeCovers(
                    Object.fromEntries(
                      missing.rows.map(({ luma_event_id }) => [
                        luma_event_id,
                        cover,
                      ]),
                    ),
                  ),
                  fakePictures,
                  fakeHosts({
                    [cover]: imageBytes("png", "cover"),
                    "https://avatars.githubusercontent.com/u/1": imageBytes(
                      "png",
                      "ada",
                    ),
                    "https://avatars.githubusercontent.com/u/2": imageBytes(
                      "png",
                      "grace",
                    ),
                  }).layer,
                ),
              ),
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(
                clockAt(DateTime.makeUnsafe("2026-10-05T12:00:00Z")),
              ),
            ),
          ),
        ),
      );
      expect(missing.rows.length).toBeGreaterThan(1);
      expect(covers.ingested).toHaveLength(1);
      expect(photos.ingested).toEqual(["Ada Lovelace"]);
    } finally {
      await db.close();
    }
  });
});

describe("the allowed hosts", () => {
  test("are exactly these, for each kind of image", () => {
    expect([...coverHosts].toSorted()).toEqual([
      "cdn.lu.ma",
      "images.lumacdn.com",
      "images.unsplash.com",
    ]);
    expect([...profilePhotoHosts].toSorted()).toEqual([
      "avatars.githubusercontent.com",
      "bookface-images.s3.amazonaws.com",
      "images.lumacdn.com",
      "media.licdn.com",
      "pbs.twimg.com",
    ]);
    expect([...postImageHosts].toSorted()).toEqual([
      "cdn.bsky.app",
      "media.licdn.com",
      "pbs.twimg.com",
      "video.bsky.app",
      "video.cdn.bsky.app",
    ]);
  });

  test("take a Bluesky video post's thumbnail through its redirect to Bluesky's video CDN, for posts alone", async () => {
    const thumbnail = imageBytes("jpeg", "video");
    const path = "did:plc:abc/bafkreithumb/thumbnail.jpg";
    const answers = {
      [`https://video.bsky.app/watch/${encodeURIComponent("did:plc:abc")}/bafkreithumb/thumbnail.jpg`]: `https://video.cdn.bsky.app/hls/${path}`,
      [`https://video.cdn.bsky.app/hls/${path}`]: thumbnail,
    };
    const url = Object.keys(answers)[0] ?? "";
    const post = fakeHosts(answers);
    const exit = await Effect.runPromiseExit(
      downloadImage(url, postImageHosts).pipe(Effect.provide(post.layer)),
    );
    expect(Exit.isSuccess(exit) && exit.value).toEqual(thumbnail);
    expect(post.asked).toEqual([url, `https://video.cdn.bsky.app/hls/${path}`]);
    // A profile photo or a cover may not come from there.
    for (const hosts of [profilePhotoHosts, coverHosts]) {
      const other = fakeHosts(answers);
      const refused = await Effect.runPromiseExit(
        downloadImage(url, hosts).pipe(Effect.provide(other.layer)),
      );
      expect(failure(refused)).toBe(
        "URL is not on an allowed host: https://video.bsky.app",
      );
      expect(other.asked).toEqual([]);
    }
  });
});
