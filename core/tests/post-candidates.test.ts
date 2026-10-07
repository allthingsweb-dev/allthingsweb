import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  ConfigProvider,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
} from "effect";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http";
import {
  bareLink,
  CandidateSearches,
  CandidateSearchError,
  type CandidateSearchShape,
  type EventSignals,
  assignEvening,
  findCandidates,
  type FoundPost,
  fromBlueskyHit,
  fromXSearch,
  makeXSearch,
  scoreCandidate,
  toSignals,
  xQueries,
} from "../src/posts/candidates.ts";
import { movePost, pendingPosts, setPostStatus } from "../src/posts/review.ts";
import { PostSources } from "../src/posts/sources.ts";
import { EventPostWriter } from "../src/posts/store.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Finding posts about an evening: the score, read from what a post says;
 * the platforms' answers as found posts; the search and the review on
 * tests/seed.sql (React at Acme, 2026-08-13 01:00–04:00 UTC, hosted at
 * Globex and Acme; Ada is @ada on X and ada.bsky.social; Luma evt-react).
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const signals: EventSignals = {
  slug: "2026-08-12-react-at-acme",
  name: "React at Acme",
  topic: "react",
  startsAt: at("2026-08-13T01:00:00Z"),
  endsAt: at("2026-08-13T04:00:00Z"),
  links: [
    "https://lu.ma/event/evt-react",
    "https://luma.com/react-at-acme",
    "https://allthings.dev/2026-08-12-react-at-acme",
  ],
  hosts: ["Globex", "Acme"],
  xHandles: ["ada"],
  // Ada's X account isn't known by id yet.
  xUserIds: [],
  xHandlesWithoutId: ["ada"],
  xFrom: ["ada"],
  blueskyHandles: ["ada.bsky.social"],
};

const post = (overrides: Partial<FoundPost> = {}): FoundPost => ({
  platform: "x",
  url: "https://x.com/someone/status/1",
  authorHandle: "someone",
  text: "",
  links: [],
  mentions: [],
  postedAt: at("2026-08-10T12:00:00Z"),
  ...overrides,
});

describe("scoreCandidate", () => {
  test("a post linking the Luma page is a candidate on that alone", () => {
    expect(
      scoreCandidate(
        signals,
        post({ links: ["https://luma.com/react-at-acme?utm=x"] }),
      ),
    ).toEqual({ score: 6, reasons: ["+6 links luma.com/react-at-acme"] });
  });

  test("a link written in the text counts as one", () => {
    expect(
      scoreCandidate(
        signals,
        post({ text: "see you there: lu.ma/event/evt-react" }),
      ).score,
    ).toBe(6);
  });

  test("everything a post can say, on the night, by someone on stage", () => {
    expect(
      scoreCandidate(
        signals,
        post({
          authorHandle: "Ada",
          text: "React at Acme tonight! All Things Web, thanks Globex",
          mentions: ["ada"],
          postedAt: at("2026-08-13T02:00:00Z"),
        }),
      ),
    ).toEqual({
      score: 4 + 3 + 1 + 2 + 1 + 2,
      reasons: [
        '+4 names "React at Acme"',
        "+3 says allthings",
        "+1 names Globex",
        "+2 by @Ada, on its stage",
        "+1 mentions @ada",
        "+2 posted on the night",
      ],
    });
  });

  test("'all things' in plain English is not the name", () => {
    const sync = { ...signals, topic: "sync" };
    // Seen in production: it says neither all things/sync nor All Things Web.
    expect(
      scoreCandidate(
        sync,
        post({
          text: "it'll have a completely out-of-sync number, all things considered.",
          postedAt: at("2026-08-13T02:00:00Z"),
        }),
      ),
    ).toEqual({
      score: 3,
      reasons: ["+1 says sync", "+2 posted on the night"],
    });
    const ai = { ...signals, topic: "ai" };
    expect(
      scoreCandidate(ai, post({ text: "A podcast about all things AI" })),
    ).toEqual({ score: 2, reasons: ['+2 says "all things ai"'] });
    expect(
      scoreCandidate(ai, post({ text: "see you at all things/ai tonight" }))
        .score,
    ).toBe(3);
    expect(
      scoreCandidate(ai, post({ text: "see you at allthings/ai tonight" }))
        .score,
    ).toBe(3);
  });

  test("a word that only resembles the topic or a host scores nothing", () => {
    expect(
      scoreCandidate(
        signals,
        post({ text: "reacting to Acmeville news, all things considered" }),
      ),
    ).toEqual({ score: 0, reasons: [] });
  });

  test("the same post and evening always score the same", () => {
    const one = post({
      text: "React at Acme",
      links: ["https://allthings.dev/2026-08-12-react-at-acme/"],
    });
    expect(scoreCandidate(signals, one)).toEqual(scoreCandidate(signals, one));
  });

  test("an X author is on stage by account id, whatever handle they post under now", () => {
    const known = {
      ...signals,
      xUserIds: ["11"],
      xHandlesWithoutId: [],
      xFrom: ["11"],
    };
    expect(
      scoreCandidate(
        known,
        post({ platform: "x", authorHandle: "ada_renamed", authorId: "11" }),
      ).reasons,
    ).toContain("+2 by @ada_renamed, on its stage");
    expect(
      scoreCandidate(
        known,
        post({ platform: "x", authorHandle: "someone", authorId: "12" }),
      ).score,
    ).toBe(0);
    // Whoever took @ada since isn't Ada: her id decides.
    expect(
      scoreCandidate(
        known,
        post({ platform: "x", authorHandle: "ada", authorId: "12" }),
      ).score,
    ).toBe(0);
    // Without an id, the handle still counts.
    expect(
      scoreCandidate(
        signals,
        post({ platform: "x", authorHandle: "ada", authorId: "12" }),
      ).score,
    ).toBe(2);
    // X's from: takes the id where it's known.
    expect(xQueries(known)[1]).toBe(
      '(from:11) ("allthings" OR "all things" OR "react") -is:retweet',
    );
  });

  test("handles count on their own platform only", () => {
    expect(
      scoreCandidate(
        signals,
        post({ platform: "bluesky", authorHandle: "ada" }),
      ).score,
    ).toBe(0);
    expect(
      scoreCandidate(
        signals,
        post({ platform: "bluesky", authorHandle: "ada.bsky.social" }),
      ).score,
    ).toBe(2);
  });
});

describe("assignEvening", () => {
  /** An evening of ours, its name, start and host as the signals have them. */
  const evening = (
    slug: string,
    name: string,
    startsAt: string,
    hosts: ReadonlyArray<string> = [],
  ): EventSignals => ({
    slug,
    name,
    topic: null,
    startsAt: at(startsAt),
    endsAt: DateTime.addDuration(at(startsAt), Duration.hours(3)),
    links: [`https://allthings.dev/${slug}`],
    hosts,
    xHandles: [],
    xUserIds: [],
    xHandlesWithoutId: [],
    xFrom: [],
    blueskyHandles: [],
  });

  test("a post on another evening's night goes to that evening", () => {
    // Goosewin's post, which the search for NextDev.fm Live found.
    const vapi = evening(
      "2025-05-28-vapi",
      "All Things Web at Vapi",
      "2025-05-29T01:00:00Z",
      ["Vapi"],
    );
    const nextdev = evening(
      "2025-06-02-nextdevfm-live",
      "NextDev.fm Live",
      "2025-06-03T01:00:00Z",
    );
    expect(
      assignEvening(
        post({
          platform: "x",
          text: "talking voice ai + mcp tonight at all things web w/ vapi in sf. so excited!",
          postedAt: at("2025-05-28T20:56:00Z"),
        }),
        [nextdev, vapi],
      )?.slug,
    ).toBe("2025-05-28-vapi");
  });

  test("a post that names another evening's host and topic goes to that one", () => {
    // Erik's shoutout, which the search for React Bay Area at Cisco Meraki found.
    const meraki = evening(
      "2024-09-24-meraki",
      "React Bay Area at Cisco Meraki",
      "2024-09-25T01:00:00Z",
      ["Cisco Meraki"],
    );
    const hackathon = {
      ...evening(
        "2024-10-05-hackathon",
        "Open Source Hackathon",
        "2024-10-05T16:00:00Z",
        ["Sentry"],
      ),
      topic: "hackathon",
    };
    expect(
      assignEvening(
        post({
          platform: "x",
          text: "Shoutout to the All Things Web crew for organizing this first open source hackathon. Big thanks to @getsentry for the space!",
          postedAt: at("2024-09-30T14:34:00Z"),
        }),
        [meraki, hackathon],
      )?.slug,
    ).toBe("2024-10-05-hackathon");
  });

  test("the evening the post names wins over the one whose search found it", () => {
    const found = evening(
      "2026-03-01-a",
      "All Things Web at Acme",
      "2026-03-02T01:00:00Z",
    );
    const named = evening(
      "2026-03-08-b",
      "All Things Web at Globex",
      "2026-03-09T01:00:00Z",
    );
    expect(
      assignEvening(
        post({
          platform: "x",
          text: "See you at All Things Web at Globex!",
          postedAt: at("2026-03-05T12:00:00Z"),
        }),
        [found, named],
      )?.slug,
    ).toBe("2026-03-08-b");
    // Outside every evening's window, it's about none of them.
    expect(
      assignEvening(
        post({
          platform: "x",
          text: "hi",
          postedAt: at("2027-01-01T00:00:00Z"),
        }),
        [found, named],
      ),
    ).toBeNull();
  });
});

describe("bareLink", () => {
  test.each([
    [
      "https://www.Luma.com/react-at-acme/?utm_source=x#top",
      "luma.com/react-at-acme",
    ],
    ["http://lu.ma/event/evt-react", "lu.ma/event/evt-react"],
  ])("%s is %s", (url, bare) => {
    expect(bareLink(url)).toBe(bare);
  });
});

describe("what platforms answer", () => {
  test("a Bluesky search hit, with its links and mentions", () => {
    expect(
      fromBlueskyHit({
        uri: "at://did:plc:abc/app.bsky.feed.post/3xyz",
        author: { handle: "ada.bsky.social" },
        record: {
          text: "Thanks @grace.example for React at Acme",
          createdAt: "2026-08-13T03:00:00.000Z",
          facets: [
            {
              features: [
                {
                  $type: "app.bsky.richtext.facet#link",
                  uri: "https://luma.com/react-at-acme",
                },
              ],
            },
          ],
          embed: { external: { uri: "https://allthings.dev/x" } },
        },
      }),
    ).toEqual({
      platform: "bluesky",
      url: "https://bsky.app/profile/did:plc:abc/post/3xyz",
      authorHandle: "ada.bsky.social",
      text: "Thanks @grace.example for React at Acme",
      links: ["https://luma.com/react-at-acme", "https://allthings.dev/x"],
      mentions: ["grace.example"],
      postedAt: at("2026-08-13T03:00:00.000Z"),
    });
  });

  test("an X search answer, its authors matched by id", () => {
    expect(
      fromXSearch({
        data: [
          {
            id: "19",
            text: "React at Acme!",
            author_id: "u1",
            created_at: "2026-08-13T03:00:00.000Z",
            entities: {
              urls: [{ expanded_url: "https://luma.com/react-at-acme" }],
              mentions: [{ username: "Ada" }],
            },
          },
          {
            id: "20",
            text: "unknown author",
            author_id: "u2",
            created_at: "2026-08-13T03:00:00.000Z",
          },
        ],
        includes: { users: [{ id: "u1", username: "grace" }] },
      }),
    ).toEqual([
      {
        platform: "x",
        url: "https://x.com/grace/status/19",
        authorHandle: "grace",
        authorId: "u1",
        text: "React at Acme!",
        links: ["https://luma.com/react-at-acme"],
        mentions: ["ada"],
        postedAt: at("2026-08-13T03:00:00.000Z"),
      },
    ]);
  });

  test("an X answer that isn't a search result fails that query; the others' posts stay", async () => {
    let sent = 0;
    const answers = [
      new Response("not json", { status: 200 }),
      Response.json({
        data: [
          {
            id: "21",
            text: "all things react tonight",
            author_id: "u1",
            created_at: "2026-10-02T03:00:00.000Z",
          },
        ],
        includes: { users: [{ id: "u1", username: "ada" }] },
      }),
    ];
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            answers[sent++] ?? new Response("", { status: 500 }),
          ),
        ),
      ),
    );
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const x: CandidateSearchShape = yield* makeXSearch;
        return yield* x.search({
          ...signals,
          startsAt: at("2026-10-02T01:00:00Z"),
          endsAt: at("2026-10-02T04:00:00Z"),
        });
      }).pipe(
        Effect.provide(Layer.merge(client, clockLayer)),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: { X_BEARER_TOKEN: "test" } }),
        ),
      ),
    );
    expect(sent).toBe(2);
    expect(found.requests).toBe(2);
    expect(found.posts.map((p) => p.url)).toEqual([
      "https://x.com/ada/status/21",
    ]);
  });

  test("asks X for 25 posts a request unless X_MAX_RESULTS says otherwise, within X's bounds", async () => {
    const asked = async (env: Record<string, string>) => {
      const sizes: Array<string | null> = [];
      const client = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          sizes.push(
            new URLSearchParams(UrlParams.toString(request.urlParams)).get(
              "max_results",
            ),
          );
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json({})),
          );
        }),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const x: CandidateSearchShape = yield* makeXSearch;
          return yield* x.search(
            {
              ...signals,
              startsAt: at("2026-10-02T01:00:00Z"),
              endsAt: at("2026-10-02T04:00:00Z"),
            },
            1,
          );
        }).pipe(
          Effect.provide(Layer.merge(client, clockLayer)),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv({ env: { X_BEARER_TOKEN: "test", ...env } }),
          ),
        ),
      );
      return sizes;
    };
    expect(await asked({})).toEqual(["25"]);
    expect(await asked({ X_MAX_RESULTS: "40" })).toEqual(["40"]);
    // Recent search takes 10 to 100; full-archive search up to 500.
    expect(await asked({ X_MAX_RESULTS: "1" })).toEqual(["10"]);
    expect(await asked({ X_MAX_RESULTS: "900" })).toEqual(["100"]);
    expect(await asked({ X_MAX_RESULTS: "900", X_SEARCH: "archive" })).toEqual([
      "500",
    ]);
  });

  test("full-archive requests a second apart, and a 429 tried again after X's reset", async () => {
    const sentAt: Array<number> = [];
    let first = true;
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        sentAt.push(Date.now());
        if (first) {
          first = false;
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("", {
                status: 429,
                // Reset at once: the wait is the floor, a second.
                headers: {
                  "x-rate-limit-reset": String(Math.floor(Date.now() / 1000)),
                },
              }),
            ),
          );
        }
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              data: [
                {
                  id: "31",
                  text: "React at Acme!",
                  author_id: "u1",
                  created_at: "2026-08-13T03:00:00.000Z",
                },
              ],
              includes: { users: [{ id: "u1", username: "ada" }] },
            }),
          ),
        );
      }),
    );
    // The real clock: the waits are real, a second or so each.
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const x: CandidateSearchShape = yield* makeXSearch;
        return yield* x.search(signals);
      }).pipe(
        Effect.provide(client),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: { X_BEARER_TOKEN: "test", X_SEARCH: "archive" },
          }),
        ),
      ),
    );
    // The 429, its retry, then the second query.
    expect(sentAt).toHaveLength(3);
    for (const [i, sent] of sentAt.entries()) {
      if (i > 0)
        expect(sent - (sentAt[i - 1] ?? 0)).toBeGreaterThanOrEqual(950);
    }
    expect(found.posts.map((p) => p.url)).toEqual([
      "https://x.com/ada/status/31",
    ]);
    // The retry counts as a request.
    expect(found.requests).toBe(3);
  }, 15_000);

  test("a 429 is tried again only while the run's requests allow", async () => {
    let sent = 0;
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        sent++;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("", { status: 429 }),
          ),
        );
      }),
    );
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const x: CandidateSearchShape = yield* makeXSearch;
        return yield* x.search(signals, 1);
      }).pipe(
        Effect.provide(client),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: { X_BEARER_TOKEN: "test", X_SEARCH: "archive" },
          }),
        ),
      ),
    );
    expect(sent).toBe(1);
    expect(Exit.isFailure(exit) ? exit.cause.reasons[0] : null).toMatchObject({
      _tag: "Fail",
      error: { requests: 1 },
    });
  });

  test("an X answer whose body stalls fails that query after 15 s, never the run", async () => {
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            // Headers at once, then a body that never comes.
            new Response(new ReadableStream({ start() {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ),
    );
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const x: CandidateSearchShape = yield* makeXSearch;
        const fiber = yield* Effect.forkChild(
          x.search(
            {
              ...signals,
              startsAt: at("2026-10-02T01:00:00Z"),
              endsAt: at("2026-10-02T04:00:00Z"),
            },
            1,
          ),
        );
        for (let i = 0; i < 20; i++) {
          yield* Effect.yieldNow;
          yield* TestClock.adjust("1 second");
        }
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.provide(Layer.merge(client, clockLayer)),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: { X_BEARER_TOKEN: "test" } }),
        ),
      ),
    );
    expect(Exit.isFailure(exit) ? exit.cause.reasons[0] : null).toMatchObject({
      _tag: "Fail",
      error: { reason: "every query failed: the answer stalled for 15 s" },
    });
  });

  test("X's queries: the evening's links and name, and its people saying allthings", () => {
    expect(xQueries(signals)).toEqual([
      '(url:"lu.ma/event/evt-react" OR url:"luma.com/react-at-acme" OR url:"allthings.dev/2026-08-12-react-at-acme" OR "React at Acme") -is:retweet',
      '(from:ada) ("allthings" OR "all things" OR "react") -is:retweet',
    ]);
  });
});

describe("toSignals", () => {
  test("links, hosts and lowercased handles from the row", () => {
    expect(
      toSignals(
        {
          slug: "s",
          name: "N",
          topic: null,
          startDate: at("2026-01-01T00:00:00Z"),
          endDate: at("2026-01-01T03:00:00Z"),
          lumaEventId: "evt-1",
          hosts: ["Acme"],
          people: [
            { x: "@Ada", xId: null, bluesky: null },
            { x: "", xId: null, bluesky: "Ada.bsky.social" },
            { x: "grace", xId: "13", bluesky: null },
          ],
        },
        "https://luma.com/n",
      ),
    ).toEqual({
      slug: "s",
      name: "N",
      topic: null,
      startsAt: at("2026-01-01T00:00:00Z"),
      endsAt: at("2026-01-01T03:00:00Z"),
      links: [
        "https://lu.ma/event/evt-1",
        "https://luma.com/event/evt-1",
        "https://luma.com/n",
        "https://allthings.dev/s",
        "https://allthingsweb.dev/s",
      ],
      hosts: ["Acme"],
      xHandles: ["ada", "grace"],
      xUserIds: ["13"],
      xHandlesWithoutId: ["ada"],
      xFrom: ["ada", "13"],
      blueskyHandles: ["ada.bsky.social"],
    });
  });
});

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

/** Searches that find `posts` on Bluesky, and fail on X as without a key. */
const fakeSearches = (posts: ReadonlyArray<FoundPost>) =>
  Layer.succeed(CandidateSearches, [
    {
      platform: "bluesky" as const,
      // Four queries, or as many as the run has left.
      search: (_signals: EventSignals, maxQueries?: number) =>
        Effect.succeed({
          posts: maxQueries === 0 ? [] : posts,
          requests: Math.min(4, maxQueries ?? 4),
        }),
    },
    {
      platform: "x" as const,
      search: () =>
        Effect.fail(
          new CandidateSearchError({
            platform: "x",
            reason: "no X_BEARER_TOKEN",
          }),
        ),
    },
  ]);

/** Reading a stored post: every candidate resolves to a Bluesky post. */
const fakeSources = Layer.succeed(
  PostSources,
  PostSources.of({
    resolve: (url) =>
      Effect.succeed({
        platform: "bluesky" as const,
        url,
        authorName: "Someone",
        authorHandle: "someone.example",
        authorUrl: null,
        authorAvatarSourceUrl: null,
        postedAt: at("2026-08-13T03:00:00Z"),
        text: "React at Acme",
        imageSourceUrl: null,
      }),
  }),
);

/** No Luma page: the HTTP client answers 404. */
const noLuma = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response("", { status: 404 })),
    ),
  ),
);

const run = (db: PGlite, posts: ReadonlyArray<FoundPost>, dryRun = false) =>
  Effect.runPromise(
    findCandidates({
      scope: { _tag: "Slugs", slugs: ["2026-08-12-react-at-acme"] },
      dryRun,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          fakeSearches(posts),
          noLuma,
          EventPostWriter.layer.pipe(Layer.provideMerge(sqlLayer(db))),
          fakeSources,
          clockLayer,
        ),
      ),
    ),
  );

const strong = post({
  platform: "bluesky",
  url: "https://bsky.app/profile/did:plc:abc/post/3strong",
  authorHandle: "someone.example",
  text: "React at Acme was great",
  links: ["https://lu.ma/event/evt-react"],
  postedAt: at("2026-08-13T03:00:00Z"),
});
const weak = post({
  platform: "bluesky",
  url: "https://bsky.app/profile/did:plc:abc/post/3weak",
  text: "react is nice",
  postedAt: at("2026-08-13T03:00:00Z"),
});
const late = post({
  ...strong,
  url: "https://bsky.app/profile/did:plc:abc/post/3late",
  postedAt: at("2026-12-01T00:00:00Z"),
});

describe("findCandidates", () => {
  test("adds what scores enough, in the window, as pending; never approves it", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const [report] = await run(db, [strong, weak, late]);
    expect(report?.searched).toEqual({ bluesky: 3, x: "no X_BEARER_TOKEN" });
    expect(report?.candidates).toEqual([
      {
        url: strong.url,
        score: 12,
        reasons: [
          "+6 links lu.ma/event/evt-react",
          '+4 names "React at Acme"',
          "+2 posted on the night",
        ],
        outcome: "added",
      },
    ]);
    const pending = await Effect.runPromise(
      pendingPosts("2026-08-12-react-at-acme").pipe(
        Effect.provide(sqlLayer(db)),
      ),
    );
    // Beside the seed's pending LinkedIn post.
    expect(pending.map((p) => p.url)).toEqual([
      strong.url,
      "https://www.linkedin.com/feed/update/urn:li:activity:7360000000000000000/",
    ]);
    // A second search finds it there, as it is.
    const [again] = await run(db, [strong]);
    expect(again?.candidates[0]?.outcome).toBe(
      "already there (pending, 2026-08-12-react-at-acme)",
    );
  });

  test("never sends more requests than the run allows", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const budgeted = (maxRequests: number) =>
      Effect.runPromise(
        findCandidates({
          scope: { _tag: "Slugs", slugs: ["2026-08-12-react-at-acme"] },
          dryRun: true,
          maxRequests,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              fakeSearches([strong]),
              noLuma,
              EventPostWriter.layer.pipe(Layer.provideMerge(sqlLayer(db))),
              fakeSources,
              clockLayer,
            ),
          ),
        ),
      );
    // The Luma page (1) and Bluesky's four queries (4) spend it all: X waits,
    // and the candidate is left for a later run.
    const [tight] = await budgeted(5);
    expect(tight?.searched).toEqual({
      bluesky: 1,
      x: "no requests left in this run",
    });
    expect(tight?.candidates.map((c) => c.outcome)).toEqual([
      "left for a later run",
    ]);
    // One more lets it be read.
    const [enough] = await budgeted(7);
    expect(enough?.candidates.map((c) => c.outcome)).toEqual(["would add"]);
  });

  test("recent evenings are the ones that ended within the window, not one still on", async () => {
    const db = await seededDatabase();
    databases.push(db);
    // Ended two days before the clock; the seed's hack day is still on, and
    // "Ends now" ends at the clock itself.
    await db.exec(`
      INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, updated_at) VALUES
        ('e0000000-0000-4000-8000-0000000000a1', '2026-09-30-just-ended', 'Just ended', 'Done', '2026-10-01T01:00:00Z', '2026-10-01T04:00:00Z', 50, false, false, now());
    `);
    const reports = await Effect.runPromise(
      findCandidates({
        scope: { _tag: "Recent", within: "7 days" },
        dryRun: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSearches([]),
            noLuma,
            EventPostWriter.layer.pipe(Layer.provideMerge(sqlLayer(db))),
            fakeSources,
            clockLayer,
          ),
        ),
      ),
    );
    expect(reports.map((report) => report.slug)).toEqual([
      "2026-09-30-just-ended",
    ]);
  });

  test("a post found for one evening that names another is filed under that one", async () => {
    const db = await seededDatabase();
    databases.push(db);
    // The search for "Ends now" finds a post about the hack day, that day.
    const aboutHackDay = post({
      platform: "bluesky",
      url: "https://bsky.app/profile/did:plc:abc/post/3hackday",
      text: "Hack day was so much fun, thanks all",
      links: ["https://allthings.dev/2026-10-03-hack-day"],
      postedAt: at("2026-10-03T22:00:00Z"),
    });
    const [report] = await Effect.runPromise(
      findCandidates({
        scope: { _tag: "Slugs", slugs: ["2026-10-03-ends-now"] },
        dryRun: false,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSearches([aboutHackDay]),
            noLuma,
            EventPostWriter.layer.pipe(Layer.provideMerge(sqlLayer(db))),
            fakeSources,
            clockLayer,
          ),
        ),
      ),
    );
    expect(report?.candidates.map((c) => c.outcome)).toEqual([
      "for 2026-10-03-hack-day: added",
    ]);
    const { rows } = await db.query<{ slug: string }>(
      `SELECT e.slug FROM event_posts p JOIN events e ON e.id = p.event_id WHERE p.url = $1`,
      [aboutHackDay.url],
    );
    expect(rows).toEqual([{ slug: "2026-10-03-hack-day" }]);
  });

  test("another evening's Luma page is read before a post is filed, or the post waits", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await db.exec(
      `UPDATE events SET luma_event_id = 'evt-hack' WHERE slug = '2026-10-03-hack-day'`,
    );
    // Luma names the hack day's page, unless reading it fails; nothing
    // else has one.
    let hackPageFails = false;
    const hackPage = () =>
      hackPageFails
        ? new Response(
            new ReadableStream({
              start: (controller) => controller.error(new Error("reset")),
            }),
          )
        : new Response(
            '<link rel="canonical" href="https://luma.com/hack-day-sf">',
          );
    const luma = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            request.url.endsWith("/event/evt-hack")
              ? hackPage()
              : new Response("", { status: 404 }),
          ),
        ),
      ),
    );
    // Found for "Ends now", which it names, but it links the hack day's
    // Luma page: only that page, once read, says which evening it's about.
    const linksHackDay = post({
      platform: "bluesky",
      url: "https://bsky.app/profile/did:plc:abc/post/3lumalink",
      text: "Ends now is wrapping up, on to the next one",
      links: ["https://luma.com/hack-day-sf"],
      postedAt: at("2026-10-03T18:00:00Z"),
    });
    const find = (maxRequests?: number) =>
      Effect.runPromise(
        findCandidates({
          scope: { _tag: "Slugs", slugs: ["2026-10-03-ends-now"] },
          dryRun: true,
          ...(maxRequests === undefined ? {} : { maxRequests }),
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              fakeSearches([linksHackDay]),
              luma,
              EventPostWriter.layer.pipe(Layer.provideMerge(sqlLayer(db))),
              fakeSources,
              clockLayer,
            ),
          ),
        ),
      );
    const [read] = await find();
    expect(read?.candidates.map((c) => c.outcome)).toEqual([
      "for 2026-10-03-hack-day: would add",
    ]);
    // With no request left to read that page, the post waits rather than
    // being filed on what the run hasn't read.
    const [tight] = await find(2);
    expect(tight?.candidates.map((c) => c.outcome)).toEqual([
      "left for a later run: another evening's Luma page is unread",
    ]);
    // A page that fails to read is unread too, not a page without a link.
    hackPageFails = true;
    const [failed] = await find();
    expect(failed?.candidates.map((c) => c.outcome)).toEqual([
      "left for a later run: another evening's Luma page is unread",
    ]);
  });

  test("a dry run scores and adds nothing", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const [report] = await run(db, [strong], true);
    expect(report?.candidates[0]?.outcome).toBe("would add");
    const pending = await Effect.runPromise(
      pendingPosts().pipe(Effect.provide(sqlLayer(db))),
    );
    expect(pending.filter((p) => p.url === strong.url)).toEqual([]);
  });
});

describe("reviewing", () => {
  test("a Bluesky post named by handle is found by its record key as written, never as a pattern", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await db.exec(`
      INSERT INTO event_posts (event_id, platform, url, author_name, author_handle, posted_at, text, status, updated_at) VALUES
        ('e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/profile/did:plc:abc/post/ab_cd', 'A', 'ada.bsky.social', now(), 't', 'pending', now()),
        ('e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/profile/did:plc:abc/post/abXcd', 'A', 'ada.bsky.social', now(), 't', 'pending', now());
    `);
    const change = await Effect.runPromise(
      setPostStatus(
        "https://bsky.app/profile/ada.bsky.social/post/ab_cd",
        "hidden",
      ).pipe(Effect.provide(sqlLayer(db))),
    );
    expect(change).toMatchObject({
      _tag: "Changed",
      url: "https://bsky.app/profile/did:plc:abc/post/ab_cd",
    });
    const { rows } = await db.query<{ url: string; status: string }>(
      "SELECT url, status FROM event_posts WHERE author_handle = 'ada.bsky.social' ORDER BY url",
    );
    expect(rows.map((r) => [r.url.slice(-5), r.status])).toEqual([
      ["abXcd", "pending"],
      ["ab_cd", "hidden"],
    ]);
  });

  test("a handle and record key that several stored posts share changes none of them", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await db.exec(`
      INSERT INTO event_posts (event_id, platform, url, author_name, author_handle, posted_at, text, status, updated_at) VALUES
        ('e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/profile/did:plc:one/post/3same', 'A', 'ada.bsky.social', now(), 't', 'pending', now()),
        ('e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/profile/did:plc:two/post/3same', 'A', 'ada.bsky.social', now(), 't', 'pending', now());
    `);
    const change = await Effect.runPromise(
      setPostStatus(
        "https://bsky.app/profile/ada.bsky.social/post/3same",
        "approved",
      ).pipe(Effect.provide(sqlLayer(db))),
    );
    expect(change).toMatchObject({
      _tag: "Ambiguous",
      url: "https://bsky.app/profile/ada.bsky.social/post/3same",
    });
    expect(
      change._tag === "Ambiguous" ? change.matches.toSorted() : [],
    ).toEqual([
      "https://bsky.app/profile/did:plc:one/post/3same",
      "https://bsky.app/profile/did:plc:two/post/3same",
    ]);
    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM event_posts WHERE url LIKE '%/post/3same'",
    );
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  test("moves a post to the evening it is about, keeping its status", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const linkedin =
      "https://www.linkedin.com/feed/update/urn:li:activity:7360000000000000000/";
    const move = (url: string, slug: string) =>
      Effect.runPromise(movePost(url, slug).pipe(Effect.provide(sqlLayer(db))));
    expect(await move(linkedin, "2026-10-03-hack-day")).toEqual({
      _tag: "Moved",
      url: linkedin,
      from: "2026-08-12-react-at-acme",
      to: "2026-10-03-hack-day",
      status: "pending",
    });
    expect(await move(linkedin, "2026-10-03-hack-day")).toMatchObject({
      _tag: "Unchanged",
    });
    expect(await move(linkedin, "no-such-evening")).toMatchObject({
      _tag: "NoSuchEvening",
      slug: "no-such-evening",
    });
    expect(
      await move("https://x.com/nobody/status/42", "2026-10-03-hack-day"),
    ).toEqual({
      _tag: "NotFound",
      url: "https://x.com/nobody/status/42",
    });
    const pending = await Effect.runPromise(
      pendingPosts("2026-10-03-hack-day").pipe(Effect.provide(sqlLayer(db))),
    );
    expect(pending.map((p) => p.url)).toEqual([linkedin]);
  });

  test("approve and hide, by URL; a hidden post stays hidden through later searches", async () => {
    const db = await seededDatabase();
    databases.push(db);
    // The seed's pending LinkedIn post.
    const linkedin =
      "https://www.linkedin.com/feed/update/urn:li:activity:7360000000000000000/";
    const review = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect);
    const set = (url: string, status: "approved" | "hidden") =>
      review(setPostStatus(url, status).pipe(Effect.provide(sqlLayer(db))));
    expect(await set(linkedin, "approved")).toMatchObject({
      _tag: "Changed",
      from: "pending",
      to: "approved",
    });
    expect(await set(linkedin, "approved")).toMatchObject({
      _tag: "Unchanged",
    });
    expect(await set("https://x.com/nobody/status/42", "hidden")).toEqual({
      _tag: "NotFound",
      url: "https://x.com/nobody/status/42",
    });

    await run(db, [strong]);
    expect(await set(strong.url, "hidden")).toMatchObject({
      _tag: "Changed",
      from: "pending",
      to: "hidden",
    });
    const [again] = await run(db, [strong]);
    expect(again?.candidates[0]?.outcome).toBe(
      "already there (hidden, 2026-08-12-react-at-acme)",
    );
  });
});
