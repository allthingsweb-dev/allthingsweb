import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { ConfigProvider, DateTime, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http";
import {
  COMMUNITY,
  type CommunityReport,
  CommunityReadError,
  CommunitySources,
  communityGaps,
  communityHistory,
  formatHistory,
  gapDays,
  isGapAnswer,
  type Metrics,
  needsAction,
  refusal,
  retriedOnShortLimit,
  retryAfterSeconds,
  shortRetrySeconds,
  type Source,
  snapshotCommunity,
  sources,
  youtubeCount,
} from "../src/community-metrics.ts";
import { communityMetrics } from "../migrations/0037_community_metrics.ts";
import { communityGaps as communityGapsMigration } from "../migrations/0038_community_gaps.ts";
import { SITE_SYNC_GRANTS } from "../../infra/scripts/site-sync.ts";
import { STUDIO_GRANTS } from "../../infra/scripts/studio.ts";
import {
  clockAt,
  migratedDatabase,
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

/** The live sources over `internet`, the test database and a test X token. */
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

/** Every source read once through the live layer: its metrics, or why it failed. */
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
              Effect.succeed(
                `${error.temporary ? "gap" : "failure"}: ${error.reason}`,
              ),
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
      expect(read.discord).toBe("gap: answered 429");
      expect(read.npm).toBe("failure: the answer is not what it should be");
      expect(read.youtube).toBe(
        "failure: the channel page shows no subscriber count",
      );
      expect(read.github).toBe("failure: the answer is not what it should be");
      expect(read.bluesky).toEqual({ followers: 50, following: 19, posts: 45 });
    },
  );
});

/**
 * A snapshot at `at`, each source answering as `answers` says, in the
 * shared database or `database`.
 */
const snapshotAt = (
  at: string,
  answers: Partial<Record<Source, Metrics | "gap" | "fail">>,
  dryRun = false,
  database?: PGlite,
) => {
  const asked: Array<Source> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(
      CommunitySources,
      CommunitySources.of({
        read: (source) => {
          asked.push(source);
          const answer = answers[source] ?? { count: 1 };
          return answer === "gap"
            ? Effect.fail(
                new CommunityReadError({
                  source,
                  reason: "answered 503",
                  temporary: true,
                }),
              )
            : answer === "fail"
              ? Effect.fail(
                  new CommunityReadError({
                    source,
                    reason: "the answer is not what it should be",
                    temporary: false,
                  }),
                )
              : Effect.succeed(answer);
        },
      }),
    ),
    sqlLayer(database ?? db),
    clockAt(DateTime.makeUnsafe(at)),
  );
  return Effect.runPromise(
    snapshotCommunity({ dryRun }).pipe(Effect.provide(layer)),
  ).then((report): CommunityReport & { asked: Array<Source> } => ({
    ...report,
    asked,
  }));
};

/** The rows stored for `day`, as `source metric value` lines. */
const stored = async (day: string) =>
  (
    await db.query<{ row: string }>(
      `SELECT source || ' ' || metric || ' ' || value AS row FROM community_metrics WHERE day = $1 ORDER BY source, metric`,
      [day],
    )
  ).rows.map(({ row }) => row);

/** The gaps recorded for `day`, as `source tries reason` lines. */
const gapRows = async (day: string) =>
  (
    await db.query<{ row: string }>(
      `SELECT source || ' ' || tries || ' ' || reason AS row FROM community_gaps WHERE day = $1 ORDER BY source`,
      [day],
    )
  ).rows.map(({ row }) => row);

/**
 * Answers that a host gives in turn, the last one again once they run out,
 * counting how often it was asked.
 */
function inTurn(...answers: ReadonlyArray<() => Response>) {
  let asked = 0;
  return {
    get asked() {
      return asked;
    },
    answer: () => {
      const next = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
      return next?.() ?? new Response(null, { status: 500 });
    },
  };
}

/** Discord's 429, waiting `header` (Retry-After) or `body` (retry_after). */
const limited = ({ header, body }: { header?: string; body?: number }) =>
  new Response(
    body === undefined
      ? '{"message":"You are being rate limited."}'
      : JSON.stringify({
          message: "You are being rate limited.",
          retry_after: body,
        }),
    {
      status: 429,
      headers: {
        ...(header === undefined ? {} : { "retry-after": header }),
        "x-ratelimit-scope": "user",
      },
    },
  );

const discordInvite = () =>
  json({ approximate_member_count: 517, approximate_presence_count: 56 });

describe("Discord's short rate limit", () => {
  test("is how long a 429 asks to wait: its header, else its body's retry_after", () => {
    expect(retryAfterSeconds({ "retry-after": "1" })).toBe(1);
    expect(
      retryAfterSeconds({ "retry-after": "0.25" }, '{"retry_after":9}'),
    ).toBe(0.25);
    expect(retryAfterSeconds({}, '{"retry_after":1.5,"global":false}')).toBe(
      1.5,
    );
    expect(
      retryAfterSeconds({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
    ).toBeUndefined();
    expect(retryAfterSeconds({}, "error code: 1015")).toBeUndefined();
    expect(retryAfterSeconds({}, '{"retry_after":-1}')).toBeUndefined();
    expect([...retriedOnShortLimit]).toEqual(["discord"]);
    expect(shortRetrySeconds).toBe(5);
  });

  test.skipIf(studioRun)(
    "is asked once more after the wait, and read when it answers",
    async () => {
      const byHeader = inTurn(() => limited({ header: "0.05" }), discordInvite);
      const read = await readAll(
        fakeInternet({ "discord.com": byHeader.answer }),
      );
      expect(read.discord).toEqual({ members: 517, online: 56 });
      expect(byHeader.asked).toBe(2);
      // Discord's body says it too, when no header does.
      const byBody = inTurn(() => limited({ body: 0.05 }), discordInvite);
      const again = await readAll(
        fakeInternet({ "discord.com": byBody.answer }),
      );
      expect(again.discord).toEqual({ members: 517, online: 56 });
      expect(byBody.asked).toBe(2);
    },
  );

  test.skipIf(studioRun)(
    "is a gap without a retry when the wait is longer, or after one retry",
    async () => {
      const long = inTurn(
        () => limited({ header: String(shortRetrySeconds + 1) }),
        discordInvite,
      );
      const read = await readAll(fakeInternet({ "discord.com": long.answer }));
      expect(read.discord).toBe(
        "gap: answered 429 (scope user, retry after 6 s)",
      );
      expect(long.asked).toBe(1);
      // A second 429 is a gap, never a third request.
      const twice = inTurn(() => limited({ header: "0.05" }));
      const again = await readAll(
        fakeInternet({ "discord.com": twice.answer }),
      );
      expect(again.discord).toBe(
        "gap: answered 429 (scope user, retry after 0.05 s)",
      );
      expect(twice.asked).toBe(2);
      // Only Discord is retried: GitHub's 429 is a gap at once.
      const github = inTurn(
        () =>
          new Response(null, { status: 429, headers: { "retry-after": "0" } }),
        () => json({ stargazers_count: 6, forks_count: 3 }),
      );
      const other = await readAll(
        fakeInternet({ "api.github.com": github.answer }),
      );
      expect(other.github).toBe("gap: answered 429 (retry after 0 s)");
      expect(github.asked).toBe(1);
    },
  );
});

describe("which outcomes count as failures", () => {
  // A gap is known and temporary: retried next run, recorded, and never
  // the sync's failure. Anything else needs someone.
  test.each([
    ["discord", 429, "gap"],
    ["npm", 429, "gap"],
    ["github", 403, "gap"],
    ["youtube", 403, "gap"],
    ["meetup", 500, "gap"],
    ["bluesky", 503, "gap"],
    ["npm", 404, "gap"],
    ["github", 404, "failure"],
    ["discord", 404, "failure"],
    ["youtube", 404, "failure"],
    ["bluesky", 400, "failure"],
    ["x", 401, "failure"],
    ["meetup", 410, "failure"],
  ] as const)("%s answering %i is a %s", (source, status, outcome) => {
    expect(isGapAnswer(source, status) ? "gap" : "failure").toBe(outcome);
  });

  test("a refusal says when to ask again, and Cloudflare's block of the address", () => {
    expect(
      refusal(403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1794074400",
      }),
    ).toBe("answered 403 (0 left, resets 18:00 UTC)");
    expect(
      refusal(429, {
        "retry-after": "3600",
        "x-ratelimit-global": "true",
        "x-ratelimit-scope": "global",
      }),
    ).toBe("answered 429 (global, scope global, retry after 3600 s)");
    expect(refusal(429, {}, "<p>error code: 1015</p>")).toBe(
      "answered 429 (Cloudflare 1015, the address is rate-limited)",
    );
    expect(refusal(503, {})).toBe("answered 503");
    // A reset past any valid date is left out rather than thrown on.
    expect(refusal(403, { "x-ratelimit-reset": "1e15" })).toBe("answered 403");
    expect(refusal(429, { "retry-after": "x".repeat(400) })).toHaveLength(200);
  });

  test.skipIf(studioRun)(
    "a live read is a gap for a rate limit, a refusal, a source down or npm's counts not out yet, else a failure",
    async () => {
      const gaps = await readAll(
        fakeInternet({
          "discord.com": () =>
            new Response("error code: 1015", {
              status: 429,
              headers: { "retry-after": "60" },
            }),
          "api.github.com": () =>
            new Response('{"message":"API rate limit exceeded"}', {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1794074400",
              },
            }),
          // As npm answered the day after the CLI was published.
          "api.npmjs.org": () =>
            new Response('{"error":"package allthings not found"}', {
              status: 404,
            }),
          "www.youtube.com": () => new Response(null, { status: 503 }),
        }),
      );
      expect(gaps.discord).toBe(
        "gap: answered 429 (Cloudflare 1015, the address is rate-limited, retry after 60 s)",
      );
      expect(gaps.github).toBe("gap: answered 403 (0 left, resets 18:00 UTC)");
      expect(gaps.npm).toBe("gap: answered 404");
      expect(gaps.youtube).toBe("gap: answered 503");
      const failures = await readAll(
        fakeInternet({
          "api.meetup.com": () => new Response(null, { status: 404 }),
          "public.api.bsky.app": () => new Response(null, { status: 401 }),
        }),
      );
      expect(failures.meetup).toBe("failure: answered 404");
      expect(failures.bluesky).toBe("failure: answered 401");
    },
  );

  test("only a failure needs action: never a skip or a gap", () => {
    expect(
      needsAction({
        failed: {},
      }),
    ).toBeUndefined();
    expect(
      needsAction({
        failed: { youtube: "the channel page shows no subscriber count" },
      }),
    ).toBe(
      "needs action: youtube (the channel page shows no subscriber count)",
    );
  });

  test.skipIf(studioRun)(
    "a gap is recorded with its tries and fails nothing, until it has lasted gapDays days",
    async () => {
      expect(gapDays).toBe(3);
      // GitHub answers on the 1st, then is a gap every hour after.
      const first = await snapshotAt("2027-01-01T05:00:00Z", {
        github: { stars: 6 },
      });
      expect(first.stored).toContain("github");
      const second = await snapshotAt("2027-01-02T05:00:00Z", {
        github: "gap",
        youtube: "fail",
      });
      expect(second.gaps).toEqual({ github: "answered 503" });
      // A failure is a failure at once, and no gap.
      expect(second.failed).toEqual({
        youtube: "the answer is not what it should be",
      });
      expect(needsAction(second)).toBe(
        "needs action: youtube (the answer is not what it should be)",
      );
      const later = await snapshotAt("2027-01-02T06:00:00Z", {
        github: "gap",
      });
      expect(needsAction(later)).toBeUndefined();
      expect(await gapRows("2027-01-02")).toEqual(["github 2 answered 503"]);
      // Still a gap on the third day without a number…
      const third = await snapshotAt("2027-01-03T05:00:00Z", { github: "gap" });
      expect(third.gaps).toEqual({ github: "answered 503" });
      expect(needsAction(third)).toBeUndefined();
      // …and on the fourth, with none since the 1st, a failure, still
      // recorded as a gap.
      const fourth = await snapshotAt("2027-01-04T05:00:00Z", {
        github: "gap",
      });
      expect(fourth.gaps).toEqual({});
      expect(fourth.failed).toEqual({
        github: "no number since 2027-01-01, 3 days of gaps: answered 503",
      });
      expect(needsAction(fourth)).toStartWith("needs action: github (");
      expect(await gapRows("2027-01-04")).toEqual(["github 1 answered 503"]);
      // Once it answers, it is read again, and the day's gap stays.
      const back = await snapshotAt("2027-01-04T06:00:00Z", {
        github: { stars: 7 },
      });
      expect(back.stored).toEqual(["github"]);
      expect(needsAction(back)).toBeUndefined();
      const gaps = await Effect.runPromise(
        communityGaps(3).pipe(
          Effect.provide(
            Layer.mergeAll(
              sqlLayer(db),
              clockAt(DateTime.makeUnsafe("2027-01-04T07:00:00Z")),
            ),
          ),
        ),
      );
      expect(gaps).toEqual([
        {
          day: "2027-01-02",
          source: "github",
          reason: "answered 503",
          tries: 2,
          first: "05:00",
          last: "06:00",
        },
        {
          day: "2027-01-03",
          source: "github",
          reason: "answered 503",
          tries: 1,
          first: "05:00",
          last: "05:00",
        },
        {
          day: "2027-01-04",
          source: "github",
          reason: "answered 503",
          tries: 1,
          first: "05:00",
          last: "05:00",
        },
      ]);
    },
  );
});

describe("a source never read", () => {
  test.skipIf(studioRun)(
    "fails on its third day of gaps, its first gap's day counted",
    async () => {
      const fresh = await migratedDatabase();
      try {
        /** A run at `when` in the fresh database, npm a gap. */
        const at = (when: string) =>
          snapshotAt(when, { npm: "gap" }, false, fresh);
        expect((await at("2027-02-01T05:00:00Z")).gaps).toEqual({
          npm: "answered 503",
        });
        expect((await at("2027-02-02T05:00:00Z")).gaps).toEqual({
          npm: "answered 503",
        });
        const third = await at("2027-02-03T05:00:00Z");
        expect(third.gaps).toEqual({});
        expect(third.failed).toEqual({
          npm: "no number yet, 3 days of gaps: answered 503",
        });
      } finally {
        await fresh.close();
      }
    },
  );
});

describe("X, read in the day's first hour only", () => {
  test.skipIf(studioRun)(
    "stays a failure all day once its gap has lasted, without being read again",
    async () => {
      const fresh = await migratedDatabase();
      try {
        /** A run at `when` in the fresh database, X answering `x`. */
        const at = (when: string, x: Metrics | "gap") =>
          snapshotAt(when, { x }, false, fresh);
        expect(
          (await at("2027-03-01T00:00:05Z", { followers: 116 })).stored,
        ).toContain("x");
        for (const day of ["02", "03"]) {
          const run = await at(`2027-03-${day}T00:00:05Z`, "gap");
          expect(run.gaps).toEqual({ x: "answered 503" });
          expect(needsAction(run)).toBeUndefined();
          // Later that day X isn't read, and its gap is no failure yet.
          const later = await at(`2027-03-${day}T05:00:00Z`, "gap");
          expect(later.asked).not.toContain("x");
          expect(needsAction(later)).toBeUndefined();
        }
        const third = await at("2027-03-04T00:00:05Z", "gap");
        expect(third.failed).toEqual({
          x: "no number since 2027-03-01, 3 days of gaps: answered 503",
        });
        // Every run after it that day still needs action, X not read.
        const later = await at("2027-03-04T05:00:00Z", "gap");
        expect(later.asked).not.toContain("x");
        expect(later.failed).toEqual({
          x: "no number since 2027-03-01, 3 days of gaps: a gap when X was last read, in a day's first hour",
        });
        // Read again the next day, it is no failure.
        const back = await at("2027-03-05T00:00:05Z", { followers: 117 });
        expect(needsAction(back)).toBeUndefined();
        expect(
          needsAction(await at("2027-03-05T05:00:00Z", "gap")),
        ).toBeUndefined();
      } finally {
        await fresh.close();
      }
    },
  );
});

describe("X, its first-hour run missed", () => {
  test.skipIf(studioRun)(
    "still fails once its open gap has lasted",
    async () => {
      const fresh = await migratedDatabase();
      try {
        /** A run at `when` in the fresh database, X answering `x`. */
        const at = (when: string, x: Metrics | "gap") =>
          snapshotAt(when, { x }, false, fresh);
        await at("2027-04-01T00:00:05Z", { followers: 116 });
        await at("2027-04-02T00:00:05Z", "gap");
        await at("2027-04-03T00:00:05Z", "gap");
        // The 4th's first-hour run never ran: its later run still knows.
        const later = await at("2027-04-04T05:00:00Z", "gap");
        expect(later.asked).not.toContain("x");
        expect(later.failed).toEqual({
          x: "no number since 2027-04-01, 3 days of gaps: a gap when X was last read, in a day's first hour",
        });
      } finally {
        await fresh.close();
      }
    },
  );
});

describe("snapshotCommunity", () => {
  test.skipIf(studioRun)(
    "in a dry run, reads every source but X and writes nothing",
    async () => {
      const dry = await snapshotAt(
        "2026-10-30T00:00:04Z",
        { discord: { members: 517, online: 56 }, npm: "gap" },
        true,
      );
      expect(dry.asked).not.toContain("x");
      expect(dry.skipped).toEqual({
        x: "a dry run never reads X, which bills each read; this hour's run would attempt to read it",
      });
      expect(dry.stored).toEqual([]);
      expect(dry.wouldStore?.discord).toEqual({ members: 517, online: 56 });
      expect(dry.gaps).toEqual({ npm: "answered 503" });
      expect(dry.failed).toEqual({});
      expect(await stored("2026-10-30")).toEqual([]);
      // Nor its gaps.
      expect(await gapRows("2026-10-30")).toEqual([]);
      // Once the day has its numbers, a dry run still reads every source
      // but X, checking each, and would store nothing.
      await snapshotAt("2026-10-30T05:00:00Z", {});
      const after = await snapshotAt("2026-10-30T06:00:00Z", {}, true);
      expect(after.asked).toEqual(sources.filter((source) => source !== "x"));
      expect(after.wouldStore).toEqual({});
      expect(after.read).toEqual(after.asked);
    },
  );

  test.skipIf(studioRun)(
    "stores every source once a day, X only in the day's first hour",
    async () => {
      // 05:00 UTC: everything but X.
      const morning = await snapshotAt("2026-11-01T05:00:04Z", {
        discord: { members: 517, online: 56 },
        npm: "gap",
      });
      expect(morning).toEqual({
        day: "2026-11-01",
        stored: ["bluesky", "youtube", "discord", "meetup", "luma", "github"],
        read: ["bluesky", "youtube", "discord", "meetup", "luma", "github"],
        kept: [],
        skipped: {
          x: "read only in the day's first hour (UTC): X bills each read",
        },
        gaps: { npm: "answered 503" },
        failed: {},
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

  test("marks a day's gap in the table and lists each, with its reason and tries", () => {
    const rows = [
      { day: "2026-11-06", source: "github", metric: "stars", value: 6 },
      { day: "2026-11-06", source: "discord", metric: "members", value: 517 },
      { day: "2026-11-07", source: "discord", metric: "members", value: 514 },
    ];
    const gap = {
      reason: "answered 429 (Cloudflare 1015, the address is rate-limited)",
      first: "02:00",
      last: "15:00",
    };
    expect(
      formatHistory(rows, [
        { ...gap, day: "2026-11-06", source: "discord", tries: 14 },
        {
          day: "2026-11-07",
          source: "github",
          reason: "answered 403 (0 left, resets 18:00 UTC)",
          tries: 1,
          first: "00:00",
          last: "00:00",
        },
        {
          day: "2026-11-07",
          source: "npm",
          reason: "answered 404",
          tries: 3,
          first: "00:00",
          last: "02:00",
        },
      ]),
    ).toBe(
      [
        "                        11-06     11-07",
        "discord members           517       514",
        "npm (no number yet)         -       gap",
        "github stars                6       gap",
        "",
        "Gaps (known and temporary: read again each hour until stored, X at most once a UTC day; 3 days with no number, today included, fail the sync):",
        "  11-06 discord  answered 429 (Cloudflare 1015, the address is rate-limited): 14 tries, 02:00–15:00 UTC, then read",
        "  11-07 github   answered 403 (0 left, resets 18:00 UTC): 1 try, 00:00 UTC",
        "  11-07 npm      answered 404: 3 tries, 00:00–02:00 UTC",
      ].join("\n"),
    );
  });
});

describe("migration 0038's grants", () => {
  test.skipIf(studioRun)(
    "give site_sync exactly what its script lists for the gaps, and the studio nothing",
    async () => {
      const fresh = await migratedDatabase();
      try {
        for (const role of ["site_sync", "studio"]) {
          await fresh.exec(
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
          );
          await fresh.exec(`REVOKE ALL ON public.community_gaps FROM ${role}`);
        }
        const statement = communityGapsMigration.at(-1) ?? "";
        expect(statement).toContain("DO $grant$");
        await fresh.exec(statement);
        /** What `role` holds on community_gaps, as `column privilege` lines. */
        const held = async (role: string) =>
          (
            await fresh.query<{ grant: string }>(
              `SELECT column_name || ' ' || lower(privilege_type) AS grant
               FROM information_schema.column_privileges
               WHERE grantee = $1 AND table_schema = 'public' AND table_name = 'community_gaps'
               ORDER BY 1`,
              [role],
            )
          ).rows.map(({ grant }) => grant);
        const listed = SITE_SYNC_GRANTS["community_gaps"] ?? {};
        expect(await held("site_sync")).toEqual(
          [
            ...(listed.select ?? []).map((column) => `${column} select`),
            ...(listed.insert ?? []).map((column) => `${column} insert`),
            ...(listed.update ?? []).map((column) => `${column} update`),
          ].toSorted(),
        );
        expect(STUDIO_GRANTS["public.community_gaps"]).toEqual({
          select: true,
        });
        expect(await held("studio")).toEqual([]);
      } finally {
        await fresh.close();
      }
    },
  );
});

describe("migration 0037's grants", () => {
  test.skipIf(studioRun)(
    "give site_sync exactly what its script lists for the snapshot, and the studio nothing",
    async () => {
      const fresh = await migratedDatabase();
      try {
        // Roles belong to the server, which other tests may have made them on.
        for (const role of ["site_sync", "studio"]) {
          await fresh.exec(
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
          );
          await fresh.exec(
            `REVOKE ALL ON public.community_metrics FROM ${role}`,
          );
        }
        await fresh.exec(
          `REVOKE SELECT (luma_guest_count, luma_checked_in_count) ON public.events FROM site_sync`,
        );
        // The grants, as production takes them: its roles exist already.
        const statement = communityMetrics.at(-1) ?? "";
        expect(statement).toContain("DO $grant$");
        await fresh.exec(statement);
        const held = async (role: string) =>
          (
            await fresh.query<{ grant: string }>(
              `SELECT table_name || '.' || column_name || ' ' || lower(privilege_type) AS grant
               FROM information_schema.column_privileges
               WHERE grantee = $1 AND table_schema = 'public'
                 AND (table_name = 'community_metrics' OR column_name IN ('luma_guest_count', 'luma_checked_in_count'))
               ORDER BY 1`,
              [role],
            )
          ).rows.map(({ grant }) => grant);
        const listed = (
          table: string,
          grants: {
            select?: ReadonlyArray<string>;
            insert?: ReadonlyArray<string>;
          },
        ) => [
          ...(grants.select ?? []).map((column) => `${table}.${column} select`),
          ...(grants.insert ?? []).map((column) => `${table}.${column} insert`),
        ];
        expect(await held("site_sync")).toEqual(
          [
            ...listed(
              "community_metrics",
              SITE_SYNC_GRANTS["community_metrics"] ?? {},
            ),
            "events.luma_checked_in_count select",
            "events.luma_guest_count select",
          ].toSorted(),
        );
        expect(SITE_SYNC_GRANTS["events"]?.select).toEqual(
          expect.arrayContaining(["luma_guest_count", "luma_checked_in_count"]),
        );
        expect(STUDIO_GRANTS["public.community_metrics"]).toEqual({
          select: true,
        });
        // The studio's own script grants it (studio.ts --apply).
        expect(await held("studio")).toEqual([]);
      } finally {
        await fresh.close();
      }
    },
  );
});
