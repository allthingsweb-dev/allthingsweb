import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  bareLink,
  CandidateSearches,
  CandidateSearchError,
  type EventSignals,
  findCandidates,
  type FoundPost,
  fromBlueskyHit,
  fromXSearch,
  scoreCandidate,
  toSignals,
  xQueries,
} from "../src/posts/candidates.ts";
import { pendingPosts, setPostStatus } from "../src/posts/review.ts";
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
        "+3 says all things",
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
        text: "React at Acme!",
        links: ["https://luma.com/react-at-acme"],
        mentions: ["ada"],
        postedAt: at("2026-08-13T03:00:00.000Z"),
      },
    ]);
  });

  test("X's queries: the evening's links and name, and its people saying all things", () => {
    expect(xQueries(signals)).toEqual([
      '(url:"lu.ma/event/evt-react" OR url:"luma.com/react-at-acme" OR url:"allthings.dev/2026-08-12-react-at-acme" OR "React at Acme") -is:retweet',
      '(from:ada) ("all things" OR "react") -is:retweet',
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
            { x: "@Ada", bluesky: null },
            { x: "", bluesky: "Ada.bsky.social" },
            { x: "ada", bluesky: null },
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
      xHandles: ["ada"],
      blueskyHandles: ["ada.bsky.social"],
    });
  });
});

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

/** Searches that find `posts` on Bluesky, and fail on X as without a key. */
const fakeSearches = (posts: ReadonlyArray<FoundPost>) =>
  Layer.succeed(CandidateSearches, [
    { platform: "bluesky" as const, search: () => Effect.succeed(posts) },
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
