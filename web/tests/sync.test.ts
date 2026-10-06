import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { ImageIngest, NewImageId } from "allthings-core/src/ingest/ingest.ts";
import { LumaApi } from "allthings-core/src/luma/api.ts";
import { LumaDescriptions } from "allthings-core/src/luma/descriptions.ts";
import { Luma } from "allthings-core/src/luma/luma.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { LumaVenues } from "allthings-core/src/luma/venues.ts";
import {
  clockAt,
  migratedDatabase,
  sqlLayer,
} from "allthings-core/tests/support/database.ts";
import {
  fakeBucket,
  fakeCovers,
  fakeHosts,
  fakePictures,
  imageBytes,
  sequentialIds,
} from "allthings-core/tests/support/ingest.ts";
import {
  configFrom,
  fakeLuma,
  fixture,
  type Reply,
} from "allthings-core/tests/support/luma.ts";
import { DateTime, Effect, Exit, Layer, Option } from "effect";
import { mediaBucket, pictures } from "../src/sync/bindings.ts";
import {
  runSync,
  type SyncLimits,
  syncLimits,
  SyncLog,
  type SyncMode,
} from "../src/sync/run.ts";
import { limitsOf, modeOf, scheduledRun } from "../src/sync/worker.ts";
import { serve } from "./support/socket.ts";

/**
 * The sync Worker's run (src/sync/run.ts) on a copy of production's schema,
 * with Luma, the image hosts, the bucket and the Images binding faked: the
 * services are core's own (tested against the app's sync in core), so this
 * holds the run around them: order, windows, limits, modes and logs.
 */

const calendar = await fixture("calendar.ics");
const stored = await fixture("stored.sql");
const at = DateTime.makeUnsafe("2026-10-05T12:00:00Z");

/** Profiles and posts with images to fetch, beside the stored fixture. */
const seed = `${stored}
  INSERT INTO profiles (id, name, title, bio, profile_type, photo_source_url, created_at, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000011', 'One', '', '', 'member', 'https://avatars.githubusercontent.com/u/11', '2024-06-11T00:00:00Z', now()),
    ('b0000000-0000-4000-8000-000000000012', 'Two', '', '', 'member', 'https://avatars.githubusercontent.com/u/12', '2024-06-12T00:00:00Z', now()),
    ('b0000000-0000-4000-8000-000000000013', 'Three', '', '', 'member', 'https://avatars.githubusercontent.com/u/13', '2024-06-13T00:00:00Z', now());
  INSERT INTO event_posts (id, event_id, platform, url, author_name, posted_at, text, image_source_url, added_at, updated_at) VALUES
    ('70000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/1', 'Ada', now(), 't', 'https://pbs.twimg.com/1.jpg', '2024-01-01T00:00:00Z', now()),
    ('70000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/2', 'Grace', now(), 't', 'https://pbs.twimg.com/2.jpg', '2024-01-02T00:00:00Z', now()),
    ('70000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/3', 'Linus', now(), 't', 'https://pbs.twimg.com/3.jpg', '2024-01-03T00:00:00Z', now());
`;

const cover = "https://images.lumacdn.com/cover.png";
const images = {
  [cover]: imageBytes("png", "cover"),
  "https://avatars.githubusercontent.com/u/11": imageBytes("png", "one"),
  "https://avatars.githubusercontent.com/u/12": imageBytes("webp", "two"),
  "https://avatars.githubusercontent.com/u/13": imageBytes("jpeg", "three"),
  "https://pbs.twimg.com/1.jpg": imageBytes("jpeg", "p1"),
  "https://pbs.twimg.com/2.jpg": imageBytes("jpeg", "p2"),
  "https://pbs.twimg.com/3.jpg": imageBytes("jpeg", "p3"),
};

/**
 * Luma's API, faked: every event it is asked about is at CodeRabbit, and
 * has a description.
 */
const placedApi = Layer.succeed(
  LumaApi,
  LumaApi.of({
    eventPeople: Option.none(),
    eventVenue: Option.some((lumaEventId: string) =>
      Effect.succeed(
        Option.some({
          lumaEventId,
          location: "CodeRabbit, 201 Spear St, San Francisco, CA 94105",
          guestsOnly: true,
        }),
      ),
    ),
    eventDescription: Option.some((lumaEventId: string) =>
      Effect.succeed(
        Option.some({
          lumaEventId,
          markdown: `# Talks\n\nAn evening about ${lumaEventId}, with talks and time to talk.`,
        }),
      ),
    ),
  }),
);

async function run(
  mode: SyncMode,
  limits: SyncLimits,
  feed: ReadonlyArray<Reply> = [{ body: calendar }],
) {
  const db = await migratedDatabase();
  await db.exec(seed);
  const missing = await db.query<{ luma_event_id: string }>(
    "SELECT luma_event_id FROM events WHERE preview_image IS NULL AND luma_event_id IS NOT NULL",
  );
  // Events the feed adds get covers too.
  const covers = new Proxy<Record<string, string>>(
    Object.fromEntries(
      missing.rows.map(({ luma_event_id }) => [luma_event_id, cover]),
    ),
    { get: () => cover },
  );
  const bucket = fakeBucket();
  const logged: Array<Record<string, unknown>> = [];
  const layer = Layer.mergeAll(
    LumaSync.layer,
    LumaVenues.layer,
    LumaDescriptions.layer,
    ImageIngest.layer,
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        placedApi,
        Luma.layer.pipe(
          Layer.provide(Layer.mergeAll(fakeLuma(feed).layer, configFrom())),
        ),
        bucket.layer,
        fakeCovers(covers),
        fakePictures,
        fakeHosts(images).layer,
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockAt(at)),
    Layer.provideMerge(Layer.succeed(NewImageId, sequentialIds())),
    Layer.provideMerge(
      Layer.succeed(SyncLog, (entry) => {
        logged.push({ ...entry });
      }),
    ),
  );
  const report = await Effect.runPromise(
    runSync(mode, limits).pipe(Effect.provide(layer)),
  );
  return { db, report, logged, bucket };
}

const count = async (db: PGlite, sql: string) =>
  Number((await db.query<{ n: number }>(sql)).rows[0]?.n);

/** Published events with a Luma page and no venue. */
const unplaced = `SELECT count(*) AS n FROM events
  WHERE is_draft = false AND luma_event_id IS NOT NULL
    AND COALESCE(full_address, street_address) IS NULL`;

describe("a sync run that writes", () => {
  test("syncs events and fills in the venues the calendar hides, stores photos, post images and covers, then imports descriptions, logging each step", async () => {
    const { db, report, logged, bucket } = await run("write", syncLimits.paid);
    try {
      expect(report.ok).toBe(true);
      expect(Object.keys(report.steps)).toEqual([
        "events",
        "venues",
        "photos",
        "posts",
        "covers",
        "descriptions",
      ]);
      expect(report.steps["events"]).toMatchObject({
        status: "done",
        syncedCount: 24,
      });
      expect(report.steps["venues"]).toMatchObject({
        status: "done",
        filled: expect.arrayContaining([
          {
            slug: "blank-venue",
            fullAddress: "CodeRabbit, 201 Spear St, San Francisco, CA 94105",
          },
        ]),
      });
      expect(await count(db, unplaced)).toBe(0);
      const described = await count(
        db,
        "SELECT count(*) AS n FROM events WHERE is_draft = false AND luma_event_id IS NOT NULL",
      );
      expect(report.steps["descriptions"]).toMatchObject({
        status: "done",
        asked: described,
        written: described,
      });
      expect(
        await count(
          db,
          "SELECT count(*) AS n FROM events WHERE luma_description LIKE '<p><strong>Talks</strong></p>%'",
        ),
      ).toBe(described);
      // A venue name an organizer typed stays beside the address.
      expect(
        (
          await db.query<{ short_location: string }>(
            "SELECT short_location FROM events WHERE slug = 'venue-tba'",
          )
        ).rows[0]?.short_location,
      ).toBe("Somewhere nice");
      expect(report.steps["photos"]).toMatchObject({
        status: "done",
        ingested: ["One", "Two", "Three"],
      });
      expect(report.steps["posts"]).toMatchObject({
        status: "done",
        remaining: 0,
      });
      expect(
        await count(
          db,
          "SELECT count(*) AS n FROM events WHERE luma_event_id IS NOT NULL AND preview_image IS NULL",
        ),
      ).toBe(0);
      expect(bucket.log.put.some(({ key }) => key.endsWith(".jpeg"))).toBe(
        true,
      );
      expect(logged.map((entry) => entry["step"])).toEqual([
        "start",
        "events",
        "venues",
        "photos",
        "posts",
        "covers",
        "descriptions",
        "summary",
      ]);
      expect(logged.every((entry) => entry["source"] === "luma-sync")).toBe(
        true,
      );
    } finally {
      await db.close();
    }
  });

  test("on the Free plan, asks about two venues and two descriptions and tries two images of each kind, leaving the rest for later runs", async () => {
    const { db, report, bucket } = await run("write", syncLimits.free);
    try {
      expect(report.ok).toBe(true);
      expect(report.steps["venues"]).toMatchObject({ asked: 2, written: 2 });
      expect(report.steps["descriptions"]).toMatchObject({
        asked: 2,
        written: 2,
      });
      expect(report.steps["photos"]).toMatchObject({
        ingested: ["One", "Two"],
      });
      expect(report.steps["posts"]).toMatchObject({ remaining: 1 });
      expect(report.steps["covers"]).toMatchObject({
        ingested: [expect.any(String), expect.any(String)],
      });
      expect(bucket.log.put).toHaveLength(6);
    } finally {
      await db.close();
    }
  });

  test("fills no venues and stores no images when Luma's calendar can't be read, as the app's cron", async () => {
    const { db, report, bucket } = await run("write", syncLimits.paid, [
      { status: 404 },
    ]);
    try {
      expect(report.ok).toBe(false);
      expect(report.steps["events"]?.status).toBe("failed");
      expect(Object.keys(report.steps)).toEqual(["events"]);
      expect(bucket.log.put).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe("a dry run", () => {
  test("writes and stores nothing, and reports what a run would do", async () => {
    const { db, report, bucket, logged } = await run(
      "dry-run",
      syncLimits.paid,
    );
    try {
      expect(report.ok).toBe(true);
      expect(report.steps["events"]).toMatchObject({
        status: "done",
        syncedCount: 24,
        changedCount: 23,
      });
      expect(report.steps["venues"]).toMatchObject({
        status: "done",
        written: null,
        filled: expect.arrayContaining([
          expect.objectContaining({ slug: "blank-venue" }),
        ]),
      });
      expect(await count(db, unplaced)).toBeGreaterThan(0);
      expect(report.steps["descriptions"]).toMatchObject({
        status: "done",
        written: null,
        changes: expect.arrayContaining([
          {
            slug: "secret-venue-night",
            summary:
              "An evening about evt-hiddenVenue, with talks and time to talk.",
          },
        ]),
      });
      expect(
        await count(
          db,
          "SELECT count(*) AS n FROM events WHERE luma_description IS NOT NULL",
        ),
      ).toBe(0);
      expect(report.steps["images"]).toMatchObject({
        status: "done",
        photos: ["One", "Two", "Three"],
      });
      expect(bucket.log.put).toEqual([]);
      expect(await count(db, "SELECT count(*) AS n FROM images")).toBe(2);
      expect(
        await count(
          db,
          "SELECT count(*) AS n FROM events WHERE luma_event_id = 'evt-goneFromFeed' OR luma_event_id IS NULL",
        ),
      ).toBe(2);
      expect(logged.at(-1)).toMatchObject({ step: "summary", mode: "dry-run" });
    } finally {
      await db.close();
    }
  });
});

describe("the Worker's switches", () => {
  test("only an explicit 'write' writes, and only 'paid' lifts the Free plan's limits", () => {
    expect(modeOf({ SYNC_MODE: "write" })).toBe("write");
    expect(modeOf({ SYNC_MODE: "dry-run" })).toBe("dry-run");
    expect(modeOf({})).toBe("dry-run");
    expect(modeOf({ SYNC_MODE: "WRITE" })).toBe("dry-run");
    expect(limitsOf({ SYNC_PLAN: "paid" })).toBe(syncLimits.paid);
    expect(limitsOf({})).toBe(syncLimits.free);
  });
});

describe("the bucket binding", () => {
  test("stores only where nothing is, and answers the public URL", async () => {
    const calls: Array<{
      key: string;
      ifNoneMatch: string | null;
      type: string;
    }> = [];
    const bucket = mediaBucket(
      {
        put: async (key, _value, options) => {
          calls.push({
            key,
            ifNoneMatch: options.onlyIf.get("if-none-match"),
            type: options.httpMetadata.contentType,
          });
          return key.includes("taken") ? null : { key };
        },
        delete: async () => undefined,
      },
      "https://media.allthings.dev/",
    );
    expect(
      await Effect.runPromise(
        bucket.put(
          "profiles/erik-peña-1.png",
          new Uint8Array([1]),
          "image/png",
        ),
      ),
    ).toBe("https://media.allthings.dev/profiles/erik-pe%C3%B1a-1.png");
    expect(calls[0]).toEqual({
      key: "profiles/erik-peña-1.png",
      ifNoneMatch: "*",
      type: "image/png",
    });
    const taken = await Effect.runPromiseExit(
      bucket.put("taken.png", new Uint8Array([1]), "image/png"),
    );
    expect(Exit.isFailure(taken)).toBe(true);
    const huge = await Effect.runPromiseExit(
      bucket.put("huge.png", new Uint8Array(20_000_001), "image/png"),
    );
    expect(Exit.isFailure(huge)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("the Images binding", () => {
  const output = (bytes: Uint8Array) =>
    Promise.resolve({ response: () => new Response(bytes) });
  const asked: Array<string> = [];
  const binding = pictures({
    info: async (stream) => {
      const text = await new Response(stream).text();
      return text === "svg"
        ? { format: "image/svg+xml" }
        : { format: "image/webp", width: 640, height: 480 };
    },
    input: () => ({
      transform: (transform) => ({
        output: (options) => {
          asked.push(
            `transform ${transform.width}x${transform.height} ${options.format}`,
          );
          return output(new Uint8Array([1, 2, 3]));
        },
      }),
      output: (options) => {
        asked.push(`output ${options.format} ${options.quality}`);
        return output(new Uint8Array([9]));
      },
    }),
  });

  test("names formats as keys do, and refuses images without a size", async () => {
    expect(
      await Effect.runPromise(binding.info(new TextEncoder().encode("webp"))),
    ).toEqual({ format: "webp", width: 640, height: 480 });
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          binding.info(new TextEncoder().encode("svg")),
        ),
      ),
    ).toBe(true);
  });

  test("converts to JPEG, and makes a tiny JPEG placeholder as a data URL", async () => {
    expect(
      await Effect.runPromise(binding.toJpeg(new Uint8Array([0]))),
    ).toEqual(new Uint8Array([9]));
    expect(
      await Effect.runPromise(binding.placeholder(new Uint8Array([0]))),
    ).toBe(`data:image/jpeg;base64,${btoa(String.fromCharCode(1, 2, 3))}`);
    expect(asked).toEqual([
      "output image/jpeg 90",
      "transform 16x16 image/jpeg",
    ]);
  });
});

describe("the Worker, from its bindings", () => {
  test("a scheduled run reads through HYPERDRIVE, fetches Luma and the image hosts, and stores in MEDIA", async () => {
    const db = await migratedDatabase();
    await db.exec(stored);
    await db.exec(
      `UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1'
       WHERE id = 'b0000000-0000-4000-8000-000000000001'`,
    );
    const server = await serve(db);
    const fetched: Array<string> = [];
    // Given to the run, not put on globalThis: Effect keeps the first fetch it
    // finds there for the process.
    const fakeFetch = Object.assign(
      async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        fetched.push(url);
        return url.startsWith("https://api.luma.com/ics/")
          ? new Response(calendar)
          : url === "https://avatars.githubusercontent.com/u/1"
            ? new Response(imageBytes("jpeg", "ada"))
            : new Response(null, { status: 404 });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const put: Array<string> = [];
    try {
      const report = await scheduledRun(
        {
          HYPERDRIVE: { connectionString: server.url },
          MEDIA: {
            put: async (key) => {
              put.push(key);
              return { key };
            },
            delete: async () => undefined,
          },
          MEDIA_ORIGIN: "https://media.allthings.dev",
          IMAGES: {
            info: async () => ({
              format: "image/jpeg",
              width: 400,
              height: 400,
            }),
            input: () => ({
              transform: () => ({
                output: async () => ({ response: () => new Response("p") }),
              }),
              output: async () => ({ response: () => new Response("j") }),
            }),
          },
          SYNC_MODE: "write",
          SYNC_PLAN: "paid",
        },
        fakeFetch,
      );
      expect(report).toMatchObject({ mode: "write", ok: true });
      expect(report.steps["events"]).toMatchObject({ syncedCount: 24 });
      expect(report.steps["photos"]).toMatchObject({
        ingested: ["Ada Lovelace"],
      });
      // Without LUMA_API_KEY, no venues or descriptions are asked for and
      // no covers are looked up, as in the app.
      expect(report.steps["venues"]).toMatchObject({
        skipped: "LUMA_API_KEY is not set",
      });
      expect(report.steps["descriptions"]).toMatchObject({
        skipped: "LUMA_API_KEY is not set",
      });
      expect(report.steps["covers"]).toMatchObject({ ingested: [] });
      expect(put).toHaveLength(1);
      expect(put[0]).toStartWith("profiles/ada-lovelace-");
      expect(fetched[0]).toStartWith("https://api.luma.com/ics/get");
    } finally {
      await server.stop();
    }
  });
});
