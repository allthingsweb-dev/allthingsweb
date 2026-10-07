import { FollowerSource } from "allthings-core/src/followers.ts";
import { CandidateSearches } from "allthings-core/src/posts/candidates.ts";
import { PostSources } from "allthings-core/src/posts/sources.ts";
import { EventPostWriter } from "allthings-core/src/posts/store.ts";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, spyOn, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { ImageIngest, NewImageId } from "allthings-core/src/ingest/ingest.ts";
import { LumaApi } from "allthings-core/src/luma/api.ts";
import { LumaDescriptions } from "allthings-core/src/luma/descriptions.ts";
import { Luma } from "allthings-core/src/luma/luma.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { ShortSlugs } from "allthings-core/src/slugs.ts";
import { LumaDrafts } from "allthings-core/src/luma/drafts.ts";
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
import { DateTime, Effect, Exit, Layer, Option, Result } from "effect";
import { grantStatements, SITE_SYNC } from "../../infra/scripts/site-sync.ts";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import {
  type ImagesInfoBinding,
  mediaBucket,
  pictures,
  type R2BucketBinding,
} from "../src/sync/bindings.ts";
import {
  runSync,
  type SyncLimits,
  syncLimits,
  SyncLog,
  type SyncMode,
} from "../src/sync/run.ts";
import worker, {
  limitsOf,
  modeOf,
  scheduledRun,
  SyncBindingsMissing,
  syncBindings,
  type SyncEnv,
} from "../src/sync/worker.ts";
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
 * has a description; every draft it is asked about is still private.
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
    eventDetails: Option.some((lumaEventId: string) =>
      Effect.succeed(
        Option.some({
          lumaEventId,
          name: "Draft night",
          startDate: DateTime.makeUnsafe("2026-11-05T01:00:00Z"),
          endDate: DateTime.makeUnsafe("2026-11-05T04:00:00Z"),
          visibility: "private" as const,
          location: null,
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

/**
 * Every row of every table outside Postgres's own schemas, in a fixed order:
 * equal snapshots mean nothing was written.
 */
async function snapshot(db: PGlite) {
  const tables = await db.query<{ name: string }>(
    `SELECT format('%I.%I', table_schema, table_name) AS name
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1`,
  );
  const rows: Record<string, ReadonlyArray<string>> = {};
  for (const { name } of tables.rows) {
    const result = await db.query<{ row: string }>(
      `SELECT t::text AS row FROM ${name} t ORDER BY 1`,
    );
    rows[name] = result.rows.map(({ row }) => row);
  }
  return rows;
}

async function run(
  mode: SyncMode,
  limits: SyncLimits,
  feed: ReadonlyArray<Reply> = [{ body: calendar }],
) {
  const db = await migratedDatabase();
  await db.exec(seed);
  const before = await snapshot(db);
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
    LumaDrafts.layer,
    ShortSlugs.layer,
    LumaDescriptions.layer,
    ImageIngest.layer,
    // Everyone has 7 followers on X here.
    Layer.succeed(
      FollowerSource,
      FollowerSource.of({
        read: (handle) =>
          Effect.succeed({
            // One account per handle.
            id: String(
              Number.parseInt(
                Buffer.from(handle).toString("hex").slice(0, 12),
                16,
              ),
            ),
            handle,
            followers: 7,
          }),
      }),
    ),
    // The post search finds nothing here; its own tests are core's.
    Layer.succeed(CandidateSearches, []),
    Layer.succeed(
      PostSources,
      PostSources.of({
        resolve: () => Effect.die(new Error("the post search found nothing")),
      }),
    ),
    EventPostWriter.layer,
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("", { status: 404 }),
          ),
        ),
      ),
    ),
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
  return { db, report, logged, bucket, before };
}

const count = async (db: PGlite, sql: string) =>
  Number((await db.query<{ n: number }>(sql)).rows[0]?.n);

/** Published events with a Luma page and no venue. */
const unplaced = `SELECT count(*) AS n FROM events
  WHERE is_draft = false AND luma_event_id IS NOT NULL
    AND COALESCE(full_address, street_address) IS NULL`;

describe("a sync run that writes", () => {
  test("syncs events, fills in the venues the calendar hides, refreshes its drafts and gives short links, stores photos, post images and covers, then imports descriptions, logging each step", async () => {
    const { db, report, logged, bucket, before } = await run(
      "write",
      syncLimits.paid,
    );
    try {
      expect(report.ok).toBe(true);
      expect(await snapshot(db)).not.toEqual(before);
      expect(Object.keys(report.steps)).toEqual([
        "events",
        "venues",
        "drafts",
        "slugs",
        "photos",
        "posts",
        "covers",
        "descriptions",
        "followers",
        "post-search",
      ]);
      // Recent evenings are searched for posts; this search finds none.
      expect(report.steps["post-search"]).toMatchObject({ status: "done" });
      // Every profile with an X handle gets its count, with when it was read.
      expect(report.steps["followers"]).toMatchObject({
        status: "done",
        failed: [],
        remaining: 0,
      });
      expect(
        await count(
          db,
          `SELECT count(*) AS n FROM profiles
            WHERE twitter_handle IS NOT NULL AND btrim(twitter_handle) <> ''
              AND (x_followers IS DISTINCT FROM 7 OR x_followers_at IS NULL)`,
        ),
      ).toBe(0);
      expect(report.steps["events"]).toMatchObject({
        status: "done",
        syncedCount: 24,
      });
      // The seed's draft is still private on Luma, a month later and renamed.
      expect(report.steps["drafts"]).toMatchObject({
        status: "done",
        public: [],
        unavailable: [],
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
      expect(report.steps["slugs"]).toMatchObject({
        status: "done",
        given: expect.arrayContaining([
          { slug: "secret-venue-night", shortSlug: "secret-venue-night" },
        ]),
      });
      expect(
        await count(
          db,
          "SELECT count(*) AS n FROM events WHERE is_draft = false AND short_slug IS NULL",
        ),
      ).toBe(0);
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
        "drafts",
        "slugs",
        "photos",
        "posts",
        "covers",
        "descriptions",
        "followers",
        "post-search",
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

  test("fills no venues, gives no links and stores no images when Luma's calendar can't be read, as the app's cron", async () => {
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
  test("leaves every row of every table as it found it, so it can run beside the app's cron", async () => {
    const { db, report, before } = await run("dry-run", syncLimits.paid);
    try {
      expect(report.ok).toBe(true);
      expect(await snapshot(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

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
      // Evenings the rehearsal rolled back are listed with their links too.
      expect(report.steps["slugs"]).toMatchObject({
        status: "done",
        written: null,
        given: expect.arrayContaining([
          {
            slug: "2026-03-07-hackathon-weekend-evt-allDay",
            shortSlug: "hackathon-weekend",
          },
        ]),
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
          "SELECT count(*) AS n FROM events WHERE short_slug IS NOT NULL OR luma_description IS NOT NULL",
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

/** The script's connection, as the owner: PGlite behind Bun.SQL's `unsafe`. */
const owner = (database: PGlite): Statements => ({
  unsafe: async (query, values) =>
    (await database.query(query, values === undefined ? [] : [...values])).rows,
});

const lumaKey = "luma-test-key";
const xToken = "x-test-token";

/** A request's URL, whatever form fetch was given it in. */
const urlOf = (input: string | URL | Request) =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

/**
 * Luma, X, Bluesky and the image hosts, answered here: every event is at
 * CodeRabbit with a cover and a description, and still private (only drafts
 * are asked whether they are); every X handle has 7 followers; no search
 * finds a post. Anything else is a 404, and listed in `unexpected`.
 */
function fakeInternet() {
  const fetched: Array<URL> = [];
  const unexpected: Array<string> = [];
  const xIds = new Map<string, string>();
  const xUser = (id: string, username: string) => ({
    id,
    username,
    public_metrics: { followers_count: 7 },
  });
  const fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = urlOf(input);
      fetched.push(url);
      const event = url.searchParams.get("event_id");
      if (url.href.startsWith("https://api.luma.com/ics/")) {
        return new Response(calendar);
      }
      if (url.href.startsWith("https://public-api.luma.com/v1/events/get")) {
        return json({
          id: event,
          access: "manage",
          hosts: [],
          geo_address_json: {
            full_address: "CodeRabbit, 201 Spear St, San Francisco, CA 94105",
          },
          location_visibility: "guests-only",
          description_md: `# Talks\n\nAn evening about ${event}, with talks and time to talk.`,
          name: "Draft night",
          start_at: "2026-11-05T01:00:00Z",
          end_at: "2026-11-05T04:00:00Z",
          visibility: "private",
          cover_url: cover,
        });
      }
      if (url.href in images) {
        return new Response(images[url.href as keyof typeof images]);
      }
      if (url.href === "https://avatars.githubusercontent.com/u/1") {
        return new Response(imageBytes("jpeg", "ada"));
      }
      const byName = /^\/2\/users\/by\/username\/([^/]+)$/.exec(url.pathname);
      if (url.hostname === "api.x.com" && byName?.[1] !== undefined) {
        const handle = decodeURIComponent(byName[1]);
        const id = String(1000 + xIds.size);
        xIds.set(id, handle);
        return json({ data: xUser(id, handle) });
      }
      if (url.hostname === "api.x.com" && url.pathname === "/2/users") {
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        return json({
          data: ids.flatMap((id) => {
            const handle = xIds.get(id);
            return handle === undefined ? [] : [xUser(id, handle)];
          }),
        });
      }
      if (url.href.startsWith("https://api.x.com/2/tweets/search/")) {
        return json({ meta: { result_count: 0 } });
      }
      if (
        url.href.startsWith(
          "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts",
        )
      ) {
        return json({ posts: [] });
      }
      if (url.href.startsWith("https://luma.com/event/")) {
        return new Response("<html></html>");
      }
      unexpected.push(url.href);
      return new Response(null, { status: 404 });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  return { fetch, fetched, unexpected };
}

/** Bindings that store and convert, recording each key stored. */
function bindings(connectionString: string) {
  const put: Array<string> = [];
  const media: R2BucketBinding = {
    put: async (key) => {
      put.push(key);
      return { key };
    },
    delete: async () => undefined,
  };
  const transforms: ImagesInfoBinding = {
    info: async () => ({ format: "image/jpeg", width: 400, height: 400 }),
    input: () => ({
      transform: () => ({
        output: async () => ({ response: () => new Response("p") }),
      }),
      output: async () => ({ response: () => new Response("j") }),
    }),
  };
  const env = {
    HYPERDRIVE: { connectionString },
    MEDIA: media,
    MEDIA_ORIGIN: "https://media.allthings.dev",
    IMAGES: transforms,
    LUMA_API_KEY: lumaKey,
    X_BEARER_TOKEN: xToken,
    SYNC_MODE: "write",
    SYNC_PLAN: "paid",
  } satisfies SyncEnv;
  return { env, put };
}

/** What the run logs, kept here instead of printed. */
function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const spy = spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("the Worker, from its bindings", () => {
  test("a scheduled run, as site_sync, reads through HYPERDRIVE, asks Luma and X, and stores in MEDIA, every step done", async () => {
    const db = await migratedDatabase();
    await db.exec(stored);
    await db.exec(
      `UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1',
         twitter_handle = 'ada'
       WHERE id = 'b0000000-0000-4000-8000-000000000001'`,
    );
    // The role as production has it, from its script's own statements;
    // every connection through the socket then runs as it.
    await provisionLoginRole(owner(db), SITE_SYNC, "test-only");
    for (const statement of grantStatements()) await db.exec(statement);
    await db.exec(`SET ROLE ${SITE_SYNC}`);
    const server = await serve(db);
    const internet = fakeInternet();
    const { env, put } = bindings(server.url);
    const logs = captureLogs();
    try {
      const report = await scheduledRun(env, internet.fetch);
      expect(
        (await db.query<{ role: string }>("SELECT current_user AS role"))
          .rows[0]?.role,
      ).toBe(SITE_SYNC);
      // and the role held: it can't delete.
      await expect(db.exec("DELETE FROM events")).rejects.toThrow(
        "permission denied",
      );
      expect(report).toMatchObject({ mode: "write", ok: true });
      for (const [name, outcome] of Object.entries(report.steps)) {
        expect([name, outcome.status]).toEqual([name, "done"]);
      }
      expect(report.steps["events"]).toMatchObject({ syncedCount: 24 });
      // With Luma's key: hidden venues, drafts, descriptions and covers.
      expect(report.steps["venues"]).toMatchObject({
        unavailable: [],
        filled: expect.arrayContaining([
          expect.objectContaining({ slug: "blank-venue" }),
        ]),
      });
      expect(report.steps["drafts"]).toMatchObject({ unavailable: [] });
      // Read before any matcher: Bun's toMatchObject leaves its matchers
      // in what it was given.
      const described = report.steps["descriptions"];
      if (described?.status !== "done") throw new Error("no descriptions");
      expect(described["unavailable"]).toEqual([]);
      expect(described["written"]).toBeTypeOf("number");
      expect(Number(described["written"])).toBeGreaterThan(0);
      expect(report.steps["covers"]).toMatchObject({
        ingested: expect.arrayContaining([expect.any(String)]),
      });
      expect(report.steps["photos"]).toMatchObject({
        ingested: ["Ada Lovelace"],
      });
      // With X's token: the count is X's own, stored with the account's id.
      expect(report.steps["followers"]).toMatchObject({ failed: [] });
      const ada = await db.query<{ x_followers: number; x_user_id: string }>(
        "SELECT x_followers, x_user_id FROM profiles WHERE id = 'b0000000-0000-4000-8000-000000000001'",
      );
      expect(ada.rows[0]).toEqual({ x_followers: 7, x_user_id: "1000" });
      const xRequests = internet.fetched.filter(
        (url) => url.hostname === "api.x.com",
      );
      expect(xRequests.length).toBeGreaterThan(0);
      expect(put.some((key) => key.startsWith("profiles/ada-lovelace-"))).toBe(
        true,
      );
      expect(put.some((key) => key.startsWith("events/"))).toBe(true);
      // Nothing was asked of a host this test doesn't answer.
      expect(internet.unexpected).toEqual([]);
      expect(internet.fetched[0]?.href).toStartWith(
        "https://api.luma.com/ics/get",
      );
      expect(logs.lines.at(-1)).toMatchObject({
        source: "luma-sync",
        step: "summary",
        ok: true,
      });
    } finally {
      logs.restore();
      await server.stop();
    }
  });
});

describe("the Worker, without what it needs", () => {
  /** Every binding a run needs, none of them reachable: nothing may use them. */
  const complete = () =>
    bindings("postgres://site_sync:unused@127.0.0.1:1/neondb").env;

  const cases: ReadonlyArray<
    readonly [string, Readonly<Record<string, unknown>>, ReadonlyArray<string>]
  > = [
    [
      "no secrets, as before move day",
      { ...complete(), LUMA_API_KEY: undefined, X_BEARER_TOKEN: undefined },
      ["LUMA_API_KEY", "X_BEARER_TOKEN"],
    ],
    [
      "no database",
      { ...complete(), HYPERDRIVE: undefined },
      ["HYPERDRIVE (NEON_SYNC_URL)"],
    ],
    [
      "a database without a connection string",
      { ...complete(), HYPERDRIVE: { connectionString: "" } },
      ["HYPERDRIVE (NEON_SYNC_URL)"],
    ],
    [
      "no Luma key",
      { ...complete(), LUMA_API_KEY: undefined },
      ["LUMA_API_KEY"],
    ],
    [
      "a blank Luma key",
      { ...complete(), LUMA_API_KEY: "  " },
      ["LUMA_API_KEY"],
    ],
    [
      "no X token",
      { ...complete(), X_BEARER_TOKEN: undefined },
      ["X_BEARER_TOKEN"],
    ],
    [
      "no bucket, origin or Images binding",
      {
        ...complete(),
        MEDIA: undefined,
        MEDIA_ORIGIN: undefined,
        IMAGES: undefined,
      },
      ["MEDIA", "MEDIA_ORIGIN", "IMAGES"],
    ],
    [
      "nothing at all",
      {},
      [
        "HYPERDRIVE (NEON_SYNC_URL)",
        "LUMA_API_KEY",
        "X_BEARER_TOKEN",
        "MEDIA",
        "MEDIA_ORIGIN",
        "IMAGES",
      ],
    ],
  ];

  for (const [name, env, missing] of cases) {
    test(`with ${name}, runs nothing and names what is missing`, async () => {
      const internet = fakeInternet();
      const logs = captureLogs();
      try {
        const error = await scheduledRun(env, internet.fetch).then(
          () => undefined,
          (rejected: unknown) => rejected,
        );
        expect(error).toBeInstanceOf(SyncBindingsMissing);
        expect((error as SyncBindingsMissing).missing).toEqual(missing);
        // No request, so no database connection either: the layer that
        // would open one is never built.
        expect(internet.fetched).toEqual([]);
        expect(logs.lines).toEqual([
          {
            source: "luma-sync",
            step: "preflight",
            status: "failed",
            mode: modeOf(env),
            missing,
            reason: (error as SyncBindingsMissing).message,
          },
        ]);
        const said = `${(error as Error).message} ${JSON.stringify(logs.lines)}`;
        for (const secret of [lumaKey, xToken, "unused@"]) {
          expect(said).not.toContain(secret);
        }
      } finally {
        logs.restore();
      }
    });
  }

  test("fails the Cron Trigger's invocation, so its event says so", async () => {
    const logs = captureLogs();
    try {
      const invocation = worker.scheduled(
        {},
        { ...complete(), LUMA_API_KEY: undefined },
      );
      await expect(invocation).rejects.toThrow(
        "The sync Worker ran nothing: it has no LUMA_API_KEY.",
      );
    } finally {
      logs.restore();
    }
  });

  test("starts with every binding", () => {
    expect(Result.isSuccess(syncBindings(complete()))).toBe(true);
  });
});
