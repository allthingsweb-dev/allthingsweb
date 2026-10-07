import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import { Promo } from "../src/promo/promo.ts";
import { Announce, ourAccount } from "../src/social/announce.ts";
import { Bluesky, facetsOf, postUrl, spansOf } from "../src/social/bluesky.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * Posting to Bluesky (src/social/) with the AT Protocol faked as
 * bsky.network/docs documents it, every request recorded: nothing here
 * reaches Bluesky. The evening is tests/seed.sql's React at Acme, whose
 * drafts mention @ada.bsky.social.
 */

const db = await seededDatabase();
afterAll(() => db.close());

const slug = "2026-08-12-react-at-acme";
const text =
  "all things/react: talks by Linus, Grace Hopper and @ada.bsky.social.\n\nWed Aug 12, 6:00 PM, hosted at Globex and Acme.\n\nhttps://lu.ma/event/evt-react";

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });
const feed = (
  texts: ReadonlyArray<string>,
  page: { readonly cursor?: string; readonly first?: number } = {},
) =>
  json({
    ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    feed: texts.map((t, i) => ({
      post: {
        uri: `at://${ourAccount.did}/app.bsky.feed.post/r${(page.first ?? 0) + i}`,
        record: { text: t },
      },
    })),
  });
const session = (did: string = ourAccount.did) =>
  json({
    accessJwt: "access-jwt",
    refreshJwt: "refresh-jwt",
    handle: ourAccount.handle,
    did,
    didDoc: {
      service: [
        {
          id: "#atproto_pds",
          type: "AtprotoPersonalDataServer",
          serviceEndpoint: "https://pds.example",
        },
      ],
    },
  });

const login = {
  BLUESKY_HANDLE: "allthingsweb.dev",
  BLUESKY_APP_PASSWORD: "test-app-password",
};

const run = async <A, E>(
  f: (announce: Announce["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
  env: Record<string, string> = login,
) => {
  const fake = fakeLumaBy((url) => url.pathname, replies);
  const layer = Announce.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Promo.layer,
        Bluesky.layer.pipe(
          Layer.provide(Layer.mergeAll(fake.layer, configFrom(env))),
        ),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(Announce.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: fake.requests };
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};
const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const reads = {
  "/xrpc/com.atproto.identity.resolveHandle": [json({ did: "did:plc:ada" })],
  "/xrpc/app.bsky.feed.getAuthorFeed": [feed(["Something else"])],
};

describe("facets", () => {
  test("links and resolved mentions, by UTF-8 bytes", () => {
    const sample = "Café → @ada.bsky.social, see https://lu.ma/x.";
    expect(spansOf(sample)).toEqual([
      { kind: "mention", value: "ada.bsky.social", byteStart: 10, byteEnd: 26 },
      { kind: "link", value: "https://lu.ma/x", byteStart: 32, byteEnd: 47 },
    ]);
    expect(new TextEncoder().encode(sample).slice(32, 47)).toEqual(
      new TextEncoder().encode("https://lu.ma/x"),
    );
    expect(
      facetsOf(sample, new Map([["ada.bsky.social", "did:plc:ada"]])),
    ).toEqual([
      {
        index: { byteStart: 10, byteEnd: 26 },
        features: [
          { $type: "app.bsky.richtext.facet#mention", did: "did:plc:ada" },
        ],
      },
      {
        index: { byteStart: 32, byteEnd: 47 },
        features: [
          { $type: "app.bsky.richtext.facet#link", uri: "https://lu.ma/x" },
        ],
      },
    ]);
    // A handle Bluesky doesn't know stays text; an email isn't a mention.
    expect(facetsOf("ask a@b.co or @nobody.example", new Map())).toEqual([]);
  });

  test("a post's page", () => {
    expect(
      postUrl("allthingsweb.dev", "at://did:plc:x/app.bsky.feed.post/3abc"),
    ).toBe("https://bsky.app/profile/allthingsweb.dev/post/3abc");
  });
});

describe("the dry run", () => {
  test("makes the post from the draft, with its token, reading only", async () => {
    const { exit, requests } = await run(
      (a) => a.prepare(slug, "announce"),
      reads,
      {},
    );
    const prepared = value(exit);
    expect(prepared.content.text).toBe(text);
    expect(prepared.content.facets).toHaveLength(2);
    expect(prepared.unresolved).toEqual([]);
    expect(prepared.alreadyPosted).toBeNull();
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          channel: "bluesky",
          account: ourAccount.did,
          slug,
          moment: "announce",
          content: prepared.content,
        }),
      ),
    );
    expect(
      requests.map(
        (r) => `${r.method} ${new URL(r.url).host}${new URL(r.url).pathname}`,
      ),
    ).toEqual([
      "GET public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle",
      "GET public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
    ]);
  });

  test("says when the account already posted this text", async () => {
    const { exit } = await run((a) => a.prepare(slug, "announce"), {
      ...reads,
      "/xrpc/app.bsky.feed.getAuthorFeed": [feed([text])],
    });
    expect(value(exit).alreadyPosted).toBe(
      `at://${ourAccount.did}/app.bsky.feed.post/r0`,
    );
  });

  test("reads the whole feed, so a post off the first page still counts", async () => {
    const { exit, requests } = await run((a) => a.prepare(slug, "announce"), {
      ...reads,
      "/xrpc/app.bsky.feed.getAuthorFeed": [
        feed(
          Array.from({ length: 50 }, (_, i) => `Newer ${i}`),
          { cursor: "page-2" },
        ),
        feed([text], { first: 50 }),
      ],
    });
    expect(value(exit).alreadyPosted).toBe(
      `at://${ourAccount.did}/app.bsky.feed.post/r50`,
    );
    const pages = requests.filter((r) => r.url.includes("getAuthorFeed"));
    expect(pages.map((r) => new URL(r.url).searchParams.get("cursor"))).toEqual(
      [null, "page-2"],
    );
  });

  test("won't call a text new when the feed is too long to read", async () => {
    const { exit } = await run((a) => a.prepare(slug, "announce"), {
      ...reads,
      "/xrpc/app.bsky.feed.getAuthorFeed": [
        feed(["Something else"], { cursor: "more" }),
      ],
    });
    expect(message(exit)).toBe(
      "The account has more than 2000 posts: Bluesky's feed can't say whether this one is out.",
    );
  });
});

describe("posting", () => {
  const token = async () =>
    value((await run((a) => a.prepare(slug, "announce"), reads)).exit).token;

  test("posts exactly what was approved, once, to the account's PDS", async () => {
    const approved = await token();
    const { exit, requests } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/xrpc/com.atproto.server.createSession": [session()],
        "/xrpc/com.atproto.repo.createRecord": [
          json({
            uri: `at://${ourAccount.did}/app.bsky.feed.post/3new`,
            cid: "bafy",
          }),
        ],
      },
    );
    expect(value(exit).url).toBe(
      "https://bsky.app/profile/allthingsweb.dev/post/3new",
    );
    const signIn = requests.find((r) => r.url.endsWith("createSession"));
    expect(signIn?.url).toBe(
      "https://bsky.social/xrpc/com.atproto.server.createSession",
    );
    const create = requests.filter((r) => r.url.endsWith("createRecord"));
    expect(create).toHaveLength(1);
    expect(create[0]?.url).toBe(
      "https://pds.example/xrpc/com.atproto.repo.createRecord",
    );
    expect(JSON.parse(create[0]?.body ?? "")).toEqual({
      repo: ourAccount.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        facets: expect.any(Array),
        langs: ["en"],
        // The Clock's now, as the test moves it.
        createdAt: expect.stringMatching(/^2026-10-03T19:00:0\d\.000Z$/),
      },
    });
  });

  test("refuses a stale token, a text already out, and another account, posting nothing", async () => {
    const approved = await token();
    const stale = await run(
      (a) => a.post(slug, "announce", "0000000000000000"),
      reads,
    );
    expect(message(stale.exit)).toMatch(
      /^What would be posted has changed since 0000000000000000 was approved/,
    );
    const already = await run((a) => a.post(slug, "announce", approved), {
      ...reads,
      "/xrpc/app.bsky.feed.getAuthorFeed": [feed([text])],
    });
    expect(message(already.exit)).toBe(
      "Already posted: https://bsky.app/profile/allthingsweb.dev/post/r0",
    );
    const other = await run((a) => a.post(slug, "announce", approved), {
      ...reads,
      "/xrpc/com.atproto.server.createSession": [
        session("did:plc:someoneelse"),
      ],
    });
    expect(message(other.exit)).toBe(
      `The app password signs in as did:plc:someoneelse, not @allthingsweb.dev (${ourAccount.did}): nothing was posted.`,
    );
    for (const { requests } of [stale, already, other]) {
      expect(requests.some((r) => r.url.endsWith("createRecord"))).toBe(false);
    }
  });

  test("never retries a post Bluesky didn't take", async () => {
    const approved = await token();
    const { exit, requests } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/xrpc/com.atproto.server.createSession": [session()],
        "/xrpc/com.atproto.repo.createRecord": [{ status: 502 }],
      },
    );
    expect(message(exit)).toBe("Bluesky refused the post: 502");
    expect(requests.filter((r) => r.url.endsWith("createRecord"))).toHaveLength(
      1,
    );
  });

  test("needs the app password to post, not to read", async () => {
    const approved = await token();
    const { exit } = await run(
      (a) => a.post(slug, "announce", approved),
      reads,
      {},
    );
    expect(message(exit)).toBe(
      "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are not set: nothing can be posted.",
    );
  });
});
