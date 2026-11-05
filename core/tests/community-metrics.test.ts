import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { ConfigProvider, DateTime, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http";
import {
  COMMUNITY,
  type CommunityReport,
  CommunityReadError,
  CommunitySources,
  communityHistory,
  formatHistory,
  type Metrics,
  type Source,
  snapshotCommunity,
  sources,
  youtubeCount,
} from "../src/community-metrics.ts";
import {
  clockAt,
  seededDatabase,
  sqlLayer,
  studioRun,
} from "./support/database.ts";

let db: PGlite;
beforeAll(async () => {
  db = await seededDatabase();
});
afterAll(() => db.close());

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

/** The public APIs, answered here as they answered on 2026-11-05. */
function fakeInternet(answers: Partial<Record<string, () => Response>> = {}) {
  const asked: Array<{ url: string; authorization: string | undefined }> = [];
  const client = HttpClient.make((request) => {
    const url = new URL(request.url);
    const query = UrlParams.toString(request.urlParams);
    asked.push({
      url: query === "" ? url.href : `${url.href}?${query}`,
      authorization: request.headers["authorization"],
    });
    const answer =
      answers[url.hostname]?.() ??
      (() => {
        switch (url.hostname) {
          case "api.x.com":
            return json({
              data: {
                public_metrics: {
                  followers_count: 116,
                  following_count: 45,
                  tweet_count: 172,
                  listed_count: 0,
                },
              },
            });
          case "public.api.bsky.app":
            return json({
              followersCount: 50,
              followsCount: 19,
              postsCount: 45,
            });
          case "www.youtube.com":
            return new Response(
              '<script>{"subscriberCountText":"50 subscribers","viewCountText":"583 views"}</script>',
            );
          case "discord.com":
            return json({
              approximate_member_count: 517,
              approximate_presence_count: 56,
            });
          case "api.meetup.com":
            return json({
              data: {
                groupByUrlname: { stats: { memberCounts: { all: 6884 } } },
              },
            });
          case "api.npmjs.org":
            return json({
              downloads: url.pathname.includes("last-week") ? 70 : 10,
            });
          case "api.github.com":
            return json({ stargazers_count: 6, forks_count: 3 });
          default:
            return new Response(null, { status: 404 });
        }
      })();
    return Effect.succeed(HttpClientResponse.fromWeb(request, answer));
  });
  return { asked, layer: Layer.succeed(HttpClient.HttpClient, client) };
}

const live = (internet: ReturnType<typeof fakeInternet>) =>
  CommunitySources.live.pipe(
    Layer.provide(
      Layer.mergeAll(
        internet.layer,
        sqlLayer(db),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ X_BEARER_TOKEN: "x-test-token" }),
        ),
      ),
    ),
  );

const readAll = (internet: ReturnType<typeof fakeInternet>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reader = yield* CommunitySources;
      const read: Partial<Record<Source, Metrics | string>> = {};
      for (const source of sources) {
        read[source] = yield* reader
          .read(source)
          .pipe(
            Effect.catchTag("CommunityReadError", (error) =>
              Effect.succeed(error.reason),
            ),
          );
      }
      return read;
    }).pipe(Effect.provide(live(internet))),
  );

describe("youtubeCount", () => {
  test("reads the count YouTube writes as text", () => {
    const page = (text: string) => `{"subscriberCountText":"${text}"}`;
    expect(youtubeCount(page("50 subscribers"), "subscriberCountText")).toBe(
      50,
    );
    expect(youtubeCount(page("1,234 subscribers"), "subscriberCountText")).toBe(
      1234,
    );
    expect(youtubeCount(page("1.2K subscribers"), "subscriberCountText")).toBe(
      1200,
    );
    expect(youtubeCount(page("3M subscribers"), "subscriberCountText")).toBe(
      3_000_000,
    );
    expect(youtubeCount(page("No subscribers"), "subscriberCountText")).toBe(
      undefined,
    );
    expect(youtubeCount("<html></html>", "viewCountText")).toBe(undefined);
  });
});

describe("the community's sources", () => {
  test.skipIf(studioRun)(
    "read each public count, and Luma's guests from the database",
    async () => {
      const internet = fakeInternet();
      const read = await readAll(internet);
      const guests = await db.query<{
        guests: number;
        checked_in: number;
        events: number;
      }>(
        `SELECT COALESCE(sum(luma_guest_count), 0)::int AS guests,
           COALESCE(sum(luma_checked_in_count), 0)::int AS checked_in,
           count(*)::int AS events
         FROM events WHERE luma_event_id IS NOT NULL AND is_draft = false`,
      );
      expect(read).toEqual({
        x: { followers: 116, following: 45, posts: 172, listed: 0 },
        bluesky: { followers: 50, following: 19, posts: 45 },
        youtube: { subscribers: 50, views: 583 },
        discord: { members: 517, online: 56 },
        meetup: { members: 6884 },
        luma: guests.rows[0] ?? "no row",
        npm: { downloads_day: 10, downloads_week: 70 },
        github: { stars: 6, forks: 3 },
      });
      // X is read with the app's token, by allthings' own user id; nothing
      // else is sent a token.
      const x = internet.asked.filter(({ url }) =>
        url.startsWith("https://api.x.com/"),
      );
      expect(x).toEqual([
        {
          url: `https://api.x.com/2/users/${COMMUNITY.xUserId}?user.fields=public_metrics`,
          authorization: "Bearer x-test-token",
        },
      ]);
      expect(
        internet.asked.filter(
          ({ url, authorization }) =>
            !url.startsWith("https://api.x.com/") &&
            authorization !== undefined,
        ),
      ).toEqual([]);
    },
  );

  test.skipIf(studioRun)(
    "fail a source that answers anything else, by name",
    async () => {
      const read = await readAll(
        fakeInternet({
          "discord.com": () => new Response(null, { status: 429 }),
          "api.npmjs.org": () => json({ error: "package allthings not found" }),
          "www.youtube.com": () => new Response("<html>consent</html>"),
          "api.github.com": () =>
            json({ stargazers_count: -1, forks_count: 0 }),
        }),
      );
      expect(read.discord).toBe("answered 429");
      expect(read.npm).toBe("the answer is not what it should be");
      expect(read.youtube).toBe("the channel page shows no subscriber count");
      expect(read.github).toBe("the answer is not what it should be");
      expect(read.bluesky).toEqual({ followers: 50, following: 19, posts: 45 });
    },
  );
});

/** A snapshot at `at`, each source answering as `answers` says. */
const snapshotAt = (
  at: string,
  answers: Partial<Record<Source, Metrics | "fail">>,
) => {
  const asked: Array<Source> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(
      CommunitySources,
      CommunitySources.of({
        read: (source) => {
          asked.push(source);
          const answer = answers[source] ?? { count: 1 };
          return answer === "fail"
            ? Effect.fail(
                new CommunityReadError({ source, reason: "answered 503" }),
              )
            : Effect.succeed(answer);
        },
      }),
    ),
    sqlLayer(db),
    clockAt(DateTime.makeUnsafe(at)),
  );
  return Effect.runPromise(snapshotCommunity.pipe(Effect.provide(layer))).then(
    (report): CommunityReport & { asked: Array<Source> } => ({
      ...report,
      asked,
    }),
  );
};

const stored = async (day: string) =>
  (
    await db.query<{ row: string }>(
      `SELECT source || ' ' || metric || ' ' || value AS row FROM community_metrics WHERE day = $1 ORDER BY source, metric`,
      [day],
    )
  ).rows.map(({ row }) => row);

describe("snapshotCommunity", () => {
  test.skipIf(studioRun)(
    "stores every source once a day, X only in the day's first hour",
    async () => {
      // 05:00 UTC: everything but X.
      const morning = await snapshotAt("2026-11-01T05:00:04Z", {
        discord: { members: 517, online: 56 },
        npm: "fail",
      });
      expect(morning).toEqual({
        day: "2026-11-01",
        stored: ["bluesky", "youtube", "discord", "meetup", "luma", "github"],
        kept: [],
        skipped: {
          x: "read only in the day's first hour (UTC): X bills each read",
        },
        failed: { npm: "answered 503" },
        asked: [
          "bluesky",
          "youtube",
          "discord",
          "meetup",
          "luma",
          "npm",
          "github",
        ],
      });
      // An hour later only what failed is read again, and its first value
      // stays: Discord's later count doesn't replace the morning's.
      const later = await snapshotAt("2026-11-01T06:00:04Z", {
        discord: { members: 600, online: 1 },
        npm: { downloads_day: 3, downloads_week: 9 },
      });
      expect(later.asked).toEqual(["npm"]);
      expect(later.stored).toEqual(["npm"]);
      expect(later.kept).toEqual([
        "bluesky",
        "youtube",
        "discord",
        "meetup",
        "luma",
        "github",
      ]);
      expect(await stored("2026-11-01")).toContain("discord members 517");
      expect(await stored("2026-11-01")).toContain("npm downloads_week 9");

      // The next day's first hour reads X, once.
      const midnight = await snapshotAt("2026-11-02T00:00:05Z", {
        x: { followers: 116 },
      });
      expect(midnight.asked[0]).toBe("x");
      expect(midnight.stored).toContain("x");
      const again = await snapshotAt("2026-11-02T00:30:00Z", {});
      expect(again.asked).toEqual([]);
      expect(await stored("2026-11-02")).toContain("x followers 116");
    },
  );

  test.skipIf(studioRun)(
    "never reads X after the first hour, even when it was never read",
    async () => {
      const report = await snapshotAt("2026-11-03T13:00:00Z", {});
      expect(report.asked).not.toContain("x");
      expect(report.stored).not.toContain("x");
    },
  );
});

describe("the history", () => {
  test("shows each source's numbers by day, oldest first, with gaps", async () => {
    await db.exec(`INSERT INTO community_metrics (day, source, metric, value) VALUES
      ('2026-10-20', 'discord', 'members', 500),
      ('2026-10-21', 'discord', 'members', 505),
      ('2026-10-21', 'x', 'followers', 110),
      ('2026-10-21', 'github', 'stars', 5)
      ON CONFLICT DO NOTHING`);
    const rows = await Effect.runPromise(
      communityHistory(3).pipe(
        Effect.provide(
          Layer.mergeAll(
            sqlLayer(db),
            clockAt(DateTime.makeUnsafe("2026-10-22T09:00:00Z")),
          ),
        ),
      ),
    );
    expect(rows).toEqual([
      { day: "2026-10-20", source: "discord", metric: "members", value: 500 },
      { day: "2026-10-21", source: "discord", metric: "members", value: 505 },
      { day: "2026-10-21", source: "github", metric: "stars", value: 5 },
      { day: "2026-10-21", source: "x", metric: "followers", value: 110 },
    ]);
    expect(formatHistory(rows)).toBe(
      [
        "                    10-20     10-21",
        "x followers             -       110",
        "discord members       500       505",
        "github stars            -         5",
      ].join("\n"),
    );
    expect(formatHistory([])).toBe("No community numbers stored yet.");
  });
});
