import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../src/approval.ts";
import { DataSourceError } from "../src/errors.ts";
import { Promo } from "../src/promo/promo.ts";
import {
  adoptSignIn,
  ourXAccount,
  XAnnounce,
} from "../src/social/announce-x.ts";
import { SentPosts } from "../src/social/sent-posts.ts";
import { sameText, X } from "../src/social/x.ts";
import {
  fromXurl,
  SignInUnavailable,
  XSignIn,
} from "../src/social/x-sign-in.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * Posting to X (src/social/) with X's API faked as docs.x.com documents it,
 * every request recorded, and the sign-in held in memory or in a fake `op`:
 * nothing here reaches X or 1Password. The evening is tests/seed.sql's
 * React at Acme; what went out is planning.sent_posts, as for Discord.
 */

const db = await seededDatabase();
afterAll(() => db.close());
beforeEach(() => db.exec("DELETE FROM planning.sent_posts"));

const slug = "2026-08-12-react-at-acme";
const env = {
  X_BEARER_TOKEN: "app-bearer",
  X_CLIENT_ID: "client-id",
  X_CLIENT_SECRET: "client-secret",
};

const json = (value: unknown, status = 200): Reply => ({
  status,
  body: JSON.stringify(value),
});
const tokens = json({
  token_type: "bearer",
  expires_in: 7200,
  access_token: "access-2",
  refresh_token: "refresh-2",
  scope: "tweet.read tweet.write users.read offline.access",
});
const me = (
  id: string = ourXAccount.id,
  username: string = ourXAccount.handle,
) => json({ data: { id, name: "All Things Web", username } });
const created = (id: string) => json({ data: { id, text: "…" } }, 201);
const signedIn = { "/2/oauth2/token": [tokens], "/2/users/me": [me()] };

const failingStore = (token: string) =>
  Layer.succeed(
    XSignIn,
    XSignIn.of({
      read: Effect.succeed(Option.some(Redacted.make(token))),
      write: () =>
        Effect.fail(
          new SignInUnavailable({ reason: "1Password didn't answer" }),
        ),
    }),
  );

const run = async <A, E>(
  f: (announce: XAnnounce["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>> = {},
  options: {
    readonly stored?: string | null;
    readonly store?: Layer.Layer<XSignIn>;
    readonly records?: Layer.Layer<SentPosts, never, SqlClient>;
    readonly env?: Record<string, string>;
  } = {},
) => {
  const fake = fakeLumaBy((url) => url.pathname, replies);
  const memory = XSignIn.memory(
    options.stored === undefined ? "refresh-1" : options.stored,
  );
  const layer = XAnnounce.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Promo.layer,
        options.store ?? memory.layer,
        options.records ?? SentPosts.layer,
        X.layer.pipe(
          Layer.provide(
            Layer.mergeAll(fake.layer, configFrom(options.env ?? env)),
          ),
        ),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(XAnnounce.use(f)).pipe(Effect.provide(layer)),
  );
  return {
    exit,
    requests: fake.requests,
    stored: memory.stored,
    posted: fake.requests.filter(
      (r) => r.method === "POST" && r.url.endsWith("/2/tweets"),
    ),
  };
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};
const reason = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};
const recorded = async () =>
  (
    await db.query<{
      channel: string;
      status: string;
      message_id: string | null;
      body: string | null;
    }>("SELECT channel, status, message_id, body FROM planning.sent_posts")
  ).rows;

const prepared = async () =>
  value((await run((a) => a.prepare(slug, "announce"))).exit);
const token = async () => (await prepared()).token;

const settleHint = `Look at https://x.com/allthingswebdev: if it's there, record it with bun run social x ${slug} --moment announce --sent <post id> (the number at the end of its link); if it isn't, let go of it with bun run social x ${slug} --moment announce --release, then approve it again.`;

describe("matching a post X reads back", () => {
  test("links count as one, whatever X shortened them to, and entities are read", () => {
    expect(
      sameText(
        "Talks &amp; demos\n\nhttps://t.co/AbC123",
        "Talks & demos\n\nhttps://lu.ma/event/evt-react",
      ),
    ).toBe(true);
    expect(sameText("Talks & demos", "Talks and demos")).toBe(false);
  });
});

describe("the dry run", () => {
  test("makes the post from the draft, with its token, reading nothing from X", async () => {
    const { exit, requests, stored } = await run((a) =>
      a.prepare(slug, "announce"),
    );
    const post = value(exit);
    expect(post.text).toContain("allthings/react");
    expect(post.sent).toBeNull();
    expect(post.token).toBe(
      await Effect.runPromise(
        approvalToken({
          channel: "x",
          account: ourXAccount.id,
          slug,
          moment: "announce",
          text: post.text,
        }),
      ),
    );
    expect(requests).toEqual([]);
    // No sign-in was spent, and nothing recorded.
    expect(stored.value).toBe("refresh-1");
    expect(await recorded()).toEqual([]);
  });
});

describe("posting", () => {
  test("signs in, keeps the new sign-in first, posts exactly what was approved once, and records it", async () => {
    const approved = await token();
    const { exit, requests, stored, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      { ...signedIn, "/2/tweets": [created("1999")] },
    );
    const result = value(exit);
    expect(result.url).toBe("https://x.com/allthingswebdev/status/1999");
    expect(stored.value).toBe("refresh-2");
    expect(
      requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    ).toEqual(["POST /2/oauth2/token", "GET /2/users/me", "POST /2/tweets"]);
    const signIn = requests[0];
    expect(signIn?.authorization).toBe(
      `Basic ${btoa("client-id:client-secret")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(signIn?.body ?? ""))).toEqual(
      { grant_type: "refresh_token", refresh_token: "refresh-1" },
    );
    expect(requests[1]?.authorization).toBe("Bearer access-2");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.authorization).toBe("Bearer access-2");
    expect(JSON.parse(posted[0]?.body ?? "")).toEqual({ text: result.text });
    expect(await recorded()).toEqual([
      { channel: "x", status: "sent", message_id: "1999", body: result.text },
    ]);

    // From then on the dry run says so, and a second post never starts.
    expect((await prepared()).sent?.status).toBe("sent");
    const twice = await run((a) => a.post(slug, "announce", approved), {
      ...signedIn,
      "/2/tweets": [created("2000")],
    });
    expect(reason(twice.exit)).toBe(`Already posted: ${result.url}`);
    expect(twice.requests).toEqual([]);
    expect(twice.stored.value).toBe("refresh-1");
  });

  test("refuses a stale token, signing in to nothing and recording nothing", async () => {
    const { exit, requests } = await run(
      (a) => a.post(slug, "announce", "0000000000000000"),
      signedIn,
    );
    expect(reason(exit)).toMatch(
      /^What would be posted has changed since 0000000000000000 was approved/,
    );
    expect(requests).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  test("two posts at once: one goes out", async () => {
    const approved = await token();
    const { exit, posted } = await run(
      (a) =>
        Effect.all(
          [
            a.post(slug, "announce", approved),
            a.post(slug, "announce", approved),
          ],
          { concurrency: 2, mode: "result" },
        ),
      { ...signedIn, "/2/tweets": [created("1999")] },
    );
    expect(value(exit).filter((r) => r._tag === "Success")).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(await recorded()).toHaveLength(1);
  });

  describe("anything that stops it before the post lets go of the claim", () => {
    test("no stored sign-in", async () => {
      const approved = await token();
      const { exit, requests } = await run(
        (a) => a.post(slug, "announce", approved),
        signedIn,
        { stored: null },
      );
      expect(reason(exit)).toBe(
        "No X sign-in is stored: run bun run social x-sign-in --from-xurl first. Nothing was posted.",
      );
      expect(requests).toEqual([]);
      expect(await recorded()).toEqual([]);
    });

    test("another account, whose new sign-in is still kept", async () => {
      const approved = await token();
      const { exit, stored, posted } = await run(
        (a) => a.post(slug, "announce", approved),
        {
          "/2/oauth2/token": [tokens],
          "/2/users/me": [me("42", "someoneelse")],
        },
      );
      expect(reason(exit)).toBe(
        `The X sign-in is @someoneelse (42), not @allthingswebdev (${ourXAccount.id}): nothing was posted.`,
      );
      expect(stored.value).toBe("refresh-2");
      expect(posted).toEqual([]);
      expect(await recorded()).toEqual([]);
    });

    test("a new sign-in 1Password didn't keep", async () => {
      const approved = await token();
      const { exit, posted } = await run(
        (a) => a.post(slug, "announce", approved),
        signedIn,
        { store: failingStore("refresh-1") },
      );
      expect(reason(exit)).toMatch(
        /^1Password didn't answer\. X has spent the stored sign-in and its new one wasn't kept, so nothing was posted\. Sign @allthingswebdev in again/,
      );
      expect(posted).toEqual([]);
      expect(await recorded()).toEqual([]);
    });

    for (const [what, reply, said] of [
      [
        "refused",
        json({ error: "invalid_request" }, 400),
        "X refused the sign-in: 400",
      ],
      ["unanswered", "drop", "X didn't answer the sign-in"],
    ] as const) {
      test(`a sign-in X ${what}`, async () => {
        const approved = await token();
        const { exit, posted, stored } = await run(
          (a) => a.post(slug, "announce", approved),
          { "/2/oauth2/token": [reply] },
        );
        expect(reason(exit)).toBe(
          `${said}, so nothing was posted. X may have spent the stored sign-in anyway: if the next try is refused too, sign @allthingswebdev in again (xurl auth oauth2 --app allthings allthingswebdev), then bun run social x-sign-in --from-xurl.`,
        );
        expect(posted).toEqual([]);
        expect(stored.value).toBe("refresh-1");
        expect(await recorded()).toEqual([]);
      });
    }

    test("a claim let go of between its taking and the post", async () => {
      const approved = await token();
      const releasedAfterClaim = Layer.effect(
        SentPosts,
        Effect.gen(function* () {
          const real = yield* SentPosts;
          return SentPosts.of({
            ...real,
            claim: (channel, at, moment, claimToken, body) =>
              real
                .claim(channel, at, moment, claimToken, body)
                .pipe(
                  Effect.tap(() =>
                    Effect.promise(() =>
                      db.exec("DELETE FROM planning.sent_posts"),
                    ),
                  ),
                ),
          });
        }),
      ).pipe(Layer.provide(SentPosts.layer));
      const { exit, posted } = await run(
        (a) => a.post(slug, "announce", approved),
        { ...signedIn, "/2/tweets": [created("1999")] },
        { records: releasedAfterClaim },
      );
      expect(reason(exit)).toBe(
        "The claim on this post was let go of before it went out: nothing was posted. Read it again with --dry-run.",
      );
      expect(posted).toEqual([]);
    });
  });

  describe("a claim the record can't settle still says what happened", () => {
    const failing = (which: "drop" | "markUnanswered") =>
      Layer.effect(
        SentPosts,
        Effect.gen(function* () {
          const real = yield* SentPosts;
          return SentPosts.of({
            ...real,
            [which]: () =>
              Effect.fail(new DataSourceError({ cause: "connection lost" })),
          });
        }),
      ).pipe(Layer.provide(SentPosts.layer));
    const stuck = (then: string) =>
      ` The record couldn't take that, so the claim still says it's going: five minutes after it started, ${then}`;
    const releaseIt = `let go of it with bun run social x ${slug} --moment announce --release.`;

    test("a sign-in that failed", async () => {
      const approved = await token();
      const { exit, posted } = await run(
        (a) => a.post(slug, "announce", approved),
        signedIn,
        { stored: null, records: failing("drop") },
      );
      expect(reason(exit)).toBe(
        `No X sign-in is stored: run bun run social x-sign-in --from-xurl first. Nothing was posted.${stuck(releaseIt)}`,
      );
      expect(posted).toEqual([]);
    });

    test("a post X refused", async () => {
      const approved = await token();
      const { exit } = await run(
        (a) => a.post(slug, "announce", approved),
        {
          ...signedIn,
          "/2/tweets": [json({ detail: "duplicate content" }, 403)],
        },
        { records: failing("drop") },
      );
      expect(reason(exit)).toBe(
        `X refused the post: 403: nothing was posted.${stuck(releaseIt)}`,
      );
    });

    test("a post X didn't answer", async () => {
      const approved = await token();
      const { exit } = await run(
        (a) => a.post(slug, "announce", approved),
        { ...signedIn, "/2/tweets": ["drop"] },
        { records: failing("markUnanswered") },
      );
      expect(reason(exit)).toBe(
        `X didn't answer the post, so it may be out. ${settleHint}${stuck("settle it as above.")}`,
      );
      expect(await recorded()).toMatchObject([{ status: "sending" }]);
    });
  });

  test("a post the record didn't take says how to record it", async () => {
    const approved = await token();
    const unrecorded = Layer.effect(
      SentPosts,
      Effect.gen(function* () {
        const real = yield* SentPosts;
        return SentPosts.of({
          ...real,
          markSent: () =>
            Effect.fail(new DataSourceError({ cause: "connection lost" })),
        });
      }),
    ).pipe(Layer.provide(SentPosts.layer));
    const { exit, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      { ...signedIn, "/2/tweets": [created("1999")] },
      { records: unrecorded },
    );
    expect(reason(exit)).toBe(
      `Posted as https://x.com/allthingswebdev/status/1999, but the record didn't take it, so the claim still says it's going. Five minutes after it started, record it with bun run social x ${slug} --moment announce --sent 1999.`,
    );
    expect(posted).toHaveLength(1);
    expect(await recorded()).toEqual([
      {
        channel: "x",
        status: "sending",
        message_id: null,
        body: (await prepared()).text,
      },
    ]);
  });

  test("a post X refuses lets go of the claim, so it can be posted once fixed", async () => {
    const approved = await token();
    const refused = await run((a) => a.post(slug, "announce", approved), {
      ...signedIn,
      "/2/tweets": [json({ detail: "duplicate content" }, 403)],
    });
    expect(reason(refused.exit)).toBe(
      "X refused the post: 403: nothing was posted.",
    );
    expect(await recorded()).toEqual([]);
    const retried = await run((a) => a.post(slug, "announce", approved), {
      ...signedIn,
      "/2/tweets": [created("1999")],
    });
    expect(value(retried.exit).id).toBe("1999");
  });

  for (const [what, reply, said] of [
    ["no answer", "drop", "X didn't answer the post"],
    ["a server error", { status: 503 }, "X failed the post: 503"],
    [
      "no answer in 30 seconds",
      "hang",
      "X didn't answer the post in 30 seconds",
    ],
  ] as const) {
    test(`${what} keeps the claim until an organizer settles it`, async () => {
      const approved = await token();
      const unanswered = await run((a) => a.post(slug, "announce", approved), {
        ...signedIn,
        "/2/tweets": [reply],
      });
      expect(reason(unanswered.exit)).toBe(
        `${said}, so it may be out. ${settleHint}`,
      );
      expect(unanswered.posted).toHaveLength(1);
      expect(await recorded()).toEqual([
        {
          channel: "x",
          status: "unanswered",
          message_id: null,
          body: (await prepared()).text,
        },
      ]);

      // Never retried, nor posted again, until settled.
      const again = await run((a) => a.post(slug, "announce", approved), {
        ...signedIn,
        "/2/tweets": [created("1999")],
      });
      expect(reason(again.exit)).toMatch(
        /^A post of this started at 2026-10-03T19:\d\d:\d\d\.000Z and was never answered, so it may be out\./,
      );
      expect(again.requests).toEqual([]);

      const released = await run((a) => a.release(slug, "announce"));
      expect(value(released.exit).status).toBe("unanswered");
      expect(released.requests).toEqual([]);
      expect(await recorded()).toEqual([]);
      const nothing = await run((a) => a.release(slug, "announce"));
      expect(reason(nothing.exit)).toBe(
        `Nothing was started for ${slug}'s announce post: there is nothing to settle.`,
      );
    });
  }
});

describe("a post an unanswered post left", () => {
  const leaveUnanswered = async () => {
    const approved = await token();
    await run((a) => a.post(slug, "announce", approved), {
      ...signedIn,
      "/2/tweets": ["drop"],
    });
    return approved;
  };
  const found = (id: string, text: string, author: string = ourXAccount.id) =>
    json({ data: { id, text, author_id: author } });
  const asListed = (text: string) =>
    text.replaceAll("&", "&amp;").replace(/https?:\/\/\S+/g, "https://t.co/x1");

  test("is recorded once X reads it back as ours, saying what was approved", async () => {
    const approved = await leaveUnanswered();
    const text = (await prepared()).text;
    const { exit, requests, posted } = await run(
      (a) => a.recordSent(slug, "announce", "1999"),
      { "/2/tweets/1999": [found("1999", asListed(text))] },
    );
    expect(value(exit)).toMatchObject({
      status: "sent",
      token: approved,
      messageId: "1999",
      url: "https://x.com/allthingswebdev/status/1999",
    });
    expect(requests.map((r) => [r.method, r.url, r.authorization])).toEqual([
      [
        "GET",
        "https://api.x.com/2/tweets/1999?tweet.fields=author_id",
        "Bearer app-bearer",
      ],
    ]);
    expect(posted).toEqual([]);
  });

  test("isn't recorded when its claim is let go of while X reads it back", async () => {
    await leaveUnanswered();
    const text = (await prepared()).text;
    const releasedFirst = Layer.effect(
      SentPosts,
      Effect.gen(function* () {
        const real = yield* SentPosts;
        return SentPosts.of({
          ...real,
          markSent: (id, messageId, url) =>
            Effect.promise(() =>
              db.exec("DELETE FROM planning.sent_posts"),
            ).pipe(Effect.andThen(real.markSent(id, messageId, url))),
        });
      }),
    ).pipe(Layer.provide(SentPosts.layer));
    const { exit } = await run(
      (a) => a.recordSent(slug, "announce", "1999"),
      { "/2/tweets/1999": [found("1999", asListed(text))] },
      { records: releasedFirst },
    );
    expect(reason(exit)).toBe(
      "The claim was let go of while this ran: nothing was recorded. Read it again with --dry-run.",
    );
    expect(await recorded()).toEqual([]);
  });

  test("is checked against the text approved, even once the draft has changed", async () => {
    const text = (await prepared()).text;
    await leaveUnanswered();
    await db.exec(
      "UPDATE events SET start_date = start_date + interval '1 hour' WHERE slug = '2026-08-12-react-at-acme'",
    );
    try {
      expect((await prepared()).text).not.toBe(text);
      const { exit } = await run(
        (a) => a.recordSent(slug, "announce", "1999"),
        { "/2/tweets/1999": [found("1999", asListed(text))] },
      );
      expect(value(exit).status).toBe("sent");
    } finally {
      await db.exec(
        "UPDATE events SET start_date = start_date - interval '1 hour' WHERE slug = '2026-08-12-react-at-acme'",
      );
    }
  });

  test("isn't recorded when it is someone else's, says something else, or doesn't exist", async () => {
    const approved = await leaveUnanswered();
    const text = (await prepared()).text;
    const theirs = await run((a) => a.recordSent(slug, "announce", "1999"), {
      "/2/tweets/1999": [found("1999", asListed(text), "42")],
    });
    expect(reason(theirs.exit)).toBe(
      "Post 1999 isn't @allthingswebdev's: nothing was recorded.",
    );
    const other = await run((a) => a.recordSent(slug, "announce", "1999"), {
      "/2/tweets/1999": [found("1999", "Hello")],
    });
    expect(reason(other.exit)).toBe(
      `Post 1999 doesn't say what was approved (${approved}), so it isn't this post: nothing was recorded.`,
    );
    for (const missing of [
      json({ errors: [{ title: "Not Found Error" }] }),
      json({ title: "Not Found" }, 404),
    ]) {
      const none = await run((a) => a.recordSent(slug, "announce", "1998"), {
        "/2/tweets/1998": [missing],
      });
      expect(reason(none.exit)).toBe(
        "X has no post 1998: copy the number at the end of the post's link on x.com.",
      );
    }
    const notAnId = await run((a) =>
      a.recordSent(slug, "announce", "../users/me"),
    );
    expect(reason(notAnId.exit)).toMatch(/^X has no post/);
    expect(notAnId.requests).toEqual([]);
    expect(await recorded()).toEqual([
      { channel: "x", status: "unanswered", message_id: null, body: text },
    ]);
  });
});

describe("keeping xurl's sign-in", () => {
  const yaml = (expiration: number) => `apps:
  allthings:
    client_id: made-up
    client_secret: made-up
    redirect_uri: http://localhost:8080/callback
    oauth2_tokens:
      allthingswebdev:
        type: oauth2
        oauth2:
          access_token: xurl-access
          refresh_token: xurl-refresh
          expiration_time: ${expiration}
default_app: allthings
`;

  const adopt = async (
    expiration: number,
    replies: Record<string, ReadonlyArray<Reply>>,
  ) => {
    const fake = fakeLumaBy((url) => url.pathname, replies);
    const memory = XSignIn.memory(null);
    const exit = await Effect.runPromiseExit(
      fromXurl(yaml(expiration), "allthings", "allthingswebdev").pipe(
        Effect.flatMap(adoptSignIn),
        Effect.provide(
          Layer.mergeAll(
            memory.layer,
            X.layer.pipe(
              Layer.provide(Layer.mergeAll(fake.layer, configFrom(env))),
            ),
          ),
        ),
        Effect.provide(clockLayer),
      ),
    );
    return { exit, requests: fake.requests, stored: memory.stored };
  };

  // The test clock is 2026-10-03T19:00:00Z.
  const later = Date.parse("2026-10-03T21:00:00Z") / 1000;
  const earlier = Date.parse("2026-10-03T17:00:00Z") / 1000;

  test("keeps it once its access token shows it is our account", async () => {
    const { exit, requests, stored } = await adopt(later, {
      "/2/users/me": [me()],
    });
    expect(value(exit)).toEqual({ verified: true });
    expect(stored.value).toBe("xurl-refresh");
    expect(requests.map((r) => [r.url, r.authorization])).toEqual([
      ["https://api.x.com/2/users/me", "Bearer xurl-access"],
    ]);
  });

  test("refuses another account's", async () => {
    const { exit, stored } = await adopt(later, {
      "/2/users/me": [me("42", "someoneelse")],
    });
    expect(reason(exit)).toMatch(/^The X sign-in is @someoneelse/);
    expect(stored.value).toBeNull();
  });

  test("keeps an expired one unchecked, spending nothing", async () => {
    const { exit, requests, stored } = await adopt(earlier, {});
    expect(value(exit)).toEqual({ verified: false });
    expect(stored.value).toBe("xurl-refresh");
    expect(requests).toEqual([]);
  });

  test("says when xurl has no sign-in for us", async () => {
    const exit = await Effect.runPromiseExit(
      fromXurl("apps:\n  allthings: {}\n", "allthings", "allthingswebdev"),
    );
    expect(reason(exit)).toBe(
      'xurl has no OAuth 2.0 sign-in for allthingswebdev on its app "allthings": run xurl auth oauth2 --app allthings allthingswebdev first.',
    );
  });
});

describe("the sign-in in 1Password", () => {
  test("is read and written through op, never on its command line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-op-"));
    try {
      const state = join(dir, "item.json");
      const log = join(dir, "calls.json");
      await Bun.write(
        state,
        JSON.stringify({
          id: "item-1",
          title: "allthings X app",
          fields: [{ id: "f1", label: "Client ID", value: "made-up" }],
        }),
      );
      await Bun.write(log, "[]");
      // A stand-in for op: `item get` prints the item, `item edit
      // --template` replaces it, and every call's arguments are logged
      // along with the template's mode.
      const op = join(dir, "op");
      await Bun.write(
        op,
        `#!/usr/bin/env bun
const [state, log] = [${JSON.stringify(state)}, ${JSON.stringify(log)}];
const args = Bun.argv.slice(2);
const calls = JSON.parse(await Bun.file(log).text());
const at = args.indexOf("--template");
const mode = at < 0 ? null : ((await import("node:fs")).statSync(args[at + 1]).mode & 0o777);
calls.push({ args, mode });
await Bun.write(log, JSON.stringify(calls));
if (args[1] === "get") process.stdout.write(await Bun.file(state).text());
else if (args[1] === "edit") await Bun.write(state, await Bun.file(args[at + 1]).text());
else process.exit(2);
`,
      );
      await chmod(op, 0o700);

      const use = <A, E>(effect: Effect.Effect<A, E, XSignIn>) =>
        Effect.runPromise(
          effect.pipe(
            Effect.provide(XSignIn.onePassword),
            Effect.provide(configFrom({ OP_BIN: op })),
          ),
        );

      expect(await use(XSignIn.use((s) => s.read))).toEqual(Option.none());
      await use(XSignIn.use((s) => s.write(Redacted.make("refresh-secret-1"))));
      await use(XSignIn.use((s) => s.write(Redacted.make("refresh-secret-2"))));
      const read = await use(XSignIn.use((s) => s.read));
      expect(Option.map(read, Redacted.value)).toEqual(
        Option.some("refresh-secret-2"),
      );

      const item = JSON.parse(await Bun.file(state).text()) as {
        fields: Array<{ label: string; type?: string }>;
      };
      expect(item.fields.map((f) => [f.label, f.type])).toEqual([
        ["Client ID", undefined],
        ["oauth2 refresh token", "CONCEALED"],
      ]);
      const calls = JSON.parse(await Bun.file(log).text()) as Array<{
        args: Array<string>;
        mode: number | null;
      }>;
      for (const call of calls) {
        expect(call.args.join(" ")).not.toContain("refresh-secret");
        expect(call.args).toContain("allthings");
      }
      const edits = calls.filter((call) => call.args[1] === "edit");
      expect(edits).toHaveLength(2);
      for (const edit of edits) {
        expect(edit.mode).toBe(0o600);
        const template = edit.args[edit.args.indexOf("--template") + 1] ?? "";
        expect(await stat(template).catch(() => null)).toBeNull();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
