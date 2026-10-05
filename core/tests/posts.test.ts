import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Exit, Layer, Schema } from "effect";
import { addPost, BackfillFile } from "../src/posts/add.ts";
import {
  fromBlueskyThread,
  fromFxTweet,
  PostSourceError,
  PostSources,
} from "../src/posts/sources.ts";
import { EventPostWriter, PostEventNotFound } from "../src/posts/store.ts";
import {
  canonicalUrl,
  linkedinPostedAt,
  parsePostUrl,
} from "../src/posts/urls.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * Posts about events: URLs read without a network, the platforms' answers
 * as recorded fixtures, and adding posts on tests/seed.sql. No test reaches
 * X, FixTweet or Bluesky.
 */

const fixture = (name: string) =>
  Bun.file(new URL(`fixtures/posts/${name}`, import.meta.url)).text();
const xPhoto = await fixture("x-photo.json");
const blueskyImages = await fixture("bluesky-images.json");

const xUrl = "https://x.com/andrelandgraf/status/2105474023287341382";
const blueskyUrl =
  "https://bsky.app/profile/andrelandgraf.com/post/3lp5q7rcqnk2v";
const blueskyDid = "did:plc:duaskytxeykyxdfz4qte6s2e";
const linkedinUrl =
  "https://www.linkedin.com/posts/someone_effect-sf-activity-7379000000000000000-AbCd";

describe("post URLs", () => {
  test.each([
    [xUrl, { platform: "x", statusId: "2105474023287341382" }],
    [
      "https://twitter.com/andrelandgraf/status/2105474023287341382/photo/1?s=20",
      { platform: "x", statusId: "2105474023287341382" },
    ],
    [
      "https://mobile.x.com/i/web/status/2105474023287341382",
      { platform: "x", statusId: "2105474023287341382" },
    ],
    [
      blueskyUrl,
      {
        platform: "bluesky",
        actor: "andrelandgraf.com",
        rkey: "3lp5q7rcqnk2v",
      },
    ],
    [
      `https://bsky.app/profile/${blueskyDid}/post/3lp5q7rcqnk2v`,
      { platform: "bluesky", actor: blueskyDid, rkey: "3lp5q7rcqnk2v" },
    ],
    [
      linkedinUrl,
      { platform: "linkedin", kind: "activity", id: "7379000000000000000" },
    ],
    [
      "https://www.linkedin.com/feed/update/urn:li:share:7379000000000000001/",
      { platform: "linkedin", kind: "share", id: "7379000000000000001" },
    ],
  ])("%s", (url, ref) => {
    expect(parsePostUrl(url)).toEqual(ref as ReturnType<typeof parsePostUrl>);
  });

  test.each([
    "https://x.com/andrelandgraf",
    "https://x.com/andrelandgraf/status/abc",
    "https://example.com/andrelandgraf/status/1",
    "https://bsky.app/profile/andrelandgraf.com",
    "https://www.linkedin.com/in/someone",
    "ftp://x.com/a/status/1",
    "not a url",
  ])("%s is no post", (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });

  test("canonical URLs name a post the same way however it was shared", () => {
    const forms = [
      xUrl,
      "https://twitter.com/AndreLandgraf/status/2105474023287341382?s=20",
    ].map((url) => canonicalUrl(parsePostUrl(url)!));
    expect(new Set(forms)).toEqual(
      new Set(["https://x.com/i/status/2105474023287341382"]),
    );
    expect(canonicalUrl(parsePostUrl(blueskyUrl)!, blueskyDid)).toBe(
      `https://bsky.app/profile/${blueskyDid}/post/3lp5q7rcqnk2v`,
    );
    expect(canonicalUrl(parsePostUrl(linkedinUrl)!)).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:7379000000000000000/",
    );
  });

  test("a LinkedIn post's id says when it was posted", () => {
    expect(DateTime.formatIso(linkedinPostedAt("7379000000000000000"))).toBe(
      DateTime.formatIso(
        DateTime.makeUnsafe(Number(7379000000000000000n >> 22n)),
      ),
    );
    expect(
      DateTime.formatIso(linkedinPostedAt("7379000000000000000")).slice(0, 7),
    ).toBe("2025-10");
  });
});

describe("what platforms answer", () => {
  test("an X post through FixTweet", () => {
    const ref = parsePostUrl(xUrl);
    if (ref?.platform !== "x") throw new Error("not an X post");
    const post = fromFxTweet(ref, JSON.parse(xPhoto));
    expect(post).toEqual({
      platform: "x",
      url: "https://x.com/i/status/2105474023287341382",
      authorName: "Andre Landgraf",
      authorHandle: "andrelandgraf",
      authorUrl: "https://x.com/andrelandgraf",
      authorAvatarSourceUrl:
        "https://pbs.twimg.com/profile_images/1971260572223275016/FG_T-KCm_200x200.jpg",
      postedAt: DateTime.makeUnsafe("2026-10-01T01:44:59Z"),
      text: "Effect 4.0 shipped IRL! 🔥",
      imageSourceUrl:
        "https://pbs.twimg.com/media/HTgldrIaQAEgAXJ.jpg?name=orig",
    });
  });

  test("a Bluesky post through the AppView, named by its author's DID", () => {
    const ref = parsePostUrl(blueskyUrl);
    if (ref?.platform !== "bluesky") throw new Error("not a Bluesky post");
    const post = fromBlueskyThread(ref, JSON.parse(blueskyImages));
    expect(post).toMatchObject({
      platform: "bluesky",
      url: `https://bsky.app/profile/${blueskyDid}/post/3lp5q7rcqnk2v`,
      authorName: "Andre Landgraf",
      authorHandle: "andrelandgraf.com",
      authorUrl: "https://bsky.app/profile/andrelandgraf.com",
      postedAt: DateTime.makeUnsafe("2025-05-14T19:27:50.188Z"),
    });
    expect(post.text).toStartWith("Yesterday, we hosted our first-ever");
    expect(post.imageSourceUrl).toStartWith(
      "https://cdn.bsky.app/img/feed_fullsize/",
    );
    expect(post.authorAvatarSourceUrl).toStartWith(
      "https://cdn.bsky.app/img/avatar/",
    );
  });
});

/** A fake X and Bluesky, answering by the URL's path. */
const fakePlatforms = (
  replies: Readonly<Record<string, ReadonlyArray<Reply>>>,
) => fakeLumaBy((url) => url.pathname, replies);

const xPath = "/status/2105474023287341382";
const blueskyPath = "/xrpc/app.bsky.feed.getPostThread";

describe("reading posts", () => {
  const resolve = (
    url: string,
    replies: Readonly<Record<string, ReadonlyArray<Reply>>>,
    manual?: Parameters<typeof PostSources.Service.resolve>[1],
  ) => {
    const platforms = fakePlatforms(replies);
    return Effect.runPromiseExit(
      settle(PostSources.use((sources) => sources.resolve(url, manual))).pipe(
        Effect.provide(
          PostSources.layer.pipe(
            Layer.provide(Layer.mergeAll(platforms.layer, configFrom())),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    ).then((exit) => ({ exit, requests: platforms.requests }));
  };

  const error = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isSuccess(exit)) throw new Error("expected a failure");
    const reason = exit.cause.reasons[0];
    return reason?._tag === "Fail" ? reason.error : reason;
  };

  test("asks FixTweet for an X post, trying again after a 503", async () => {
    const { exit, requests } = await resolve(xUrl, {
      [xPath]: [{ status: 503 }, { body: xPhoto }],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([
      "https://api.fxtwitter.com/status/2105474023287341382",
      "https://api.fxtwitter.com/status/2105474023287341382",
    ]);
  });

  test("asks Bluesky's public AppView for the post's thread", async () => {
    const { exit, requests } = await resolve(blueskyUrl, {
      [blueskyPath]: [{ body: blueskyImages }],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fandrelandgraf.com%2Fapp.bsky.feed.post%2F3lp5q7rcqnk2v&depth=0&parentHeight=0",
    ]);
  });

  test.each([
    ["a 404", { [xPath]: [{ status: 404 }] }, "answered 404"],
    [
      "another post",
      {
        [xPath]: [
          { body: xPhoto.replace('"id": "2105474023287341382"', '"id": "1"') },
        ],
      },
      "FixTweet served post 1",
    ],
    [
      "an answer that isn't a post",
      { [xPath]: [{ body: "{}" }] },
      "not a post as expected",
    ],
  ] as const)("fails on %s", async (_, replies, reason) => {
    const failed = error((await resolve(xUrl, replies)).exit);
    expect(failed).toBeInstanceOf(PostSourceError);
    expect((failed as PostSourceError).reason).toContain(reason);
  });

  test("takes a LinkedIn post's text and author from whoever adds it", async () => {
    const missing = await resolve(linkedinUrl, {});
    expect((error(missing.exit) as PostSourceError).reason).toContain(
      "LinkedIn serves no public post data",
    );
    const { exit, requests } = await resolve(
      linkedinUrl,
      {},
      {
        authorName: " Someone ",
        authorUrl: "https://www.linkedin.com/in/someone",
        text: "Great night at Effect SF.\r\n",
      },
    );
    expect(requests).toEqual([]);
    expect(exit).toEqual(
      Exit.succeed({
        platform: "linkedin",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:7379000000000000000/",
        authorName: "Someone",
        authorHandle: null,
        authorUrl: "https://www.linkedin.com/in/someone",
        authorAvatarSourceUrl: null,
        postedAt: linkedinPostedAt("7379000000000000000"),
        text: "Great night at Effect SF.",
        imageSourceUrl: null,
      }),
    );
  });

  test("refuses a URL that is no post, without asking anyone", async () => {
    const { exit, requests } = await resolve("https://x.com/andrelandgraf", {});
    expect((error(exit) as PostSourceError).reason).toBe(
      "not an X, Bluesky or LinkedIn post URL",
    );
    expect(requests).toEqual([]);
  });
});

describe("adding posts", () => {
  const opened: Array<PGlite> = [];
  afterAll(() => Promise.all(opened.map((db) => db.close())));
  const database = async () => {
    const db = await seededDatabase();
    opened.push(db);
    return db;
  };

  const add = (
    db: PGlite,
    slug: string,
    url: string,
    options: Parameters<typeof addPost>[2] = {},
    replies: Readonly<Record<string, ReadonlyArray<Reply>>> = {
      [xPath]: [{ body: xPhoto }],
      [blueskyPath]: [{ body: blueskyImages }],
    },
  ) => {
    const platforms = fakePlatforms(replies);
    return Effect.runPromiseExit(
      settle(addPost(slug, url, options)).pipe(
        Effect.provide(
          Layer.mergeAll(PostSources.layer, EventPostWriter.layer).pipe(
            Layer.provide(Layer.mergeAll(platforms.layer, configFrom())),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    ).then((exit) => ({ exit, requests: platforms.requests }));
  };

  const rows = async (db: PGlite) =>
    (
      await db.query(`
        SELECT e.slug, p.platform, p.url, p.author_name, p.author_handle,
          p.author_url, p.author_avatar_source_url, p.posted_at, p.text,
          p.image_source_url, p.image, p.author_avatar, p.status
        FROM event_posts p JOIN events e ON e.id = p.event_id
        -- Leave out the posts tests/seed.sql holds.
        WHERE p.id::text NOT LIKE 'f0000000-%'
        ORDER BY p.url`)
    ).rows;

  test("stores a post approved, with its images as sources to copy", async () => {
    const db = await database();
    const { exit } = await add(db, "2026-08-12-react-at-acme", xUrl);
    expect(exit).toMatchObject(
      Exit.succeed({
        _tag: "Added",
        url: "https://x.com/i/status/2105474023287341382",
      }),
    );
    expect(await rows(db)).toEqual([
      {
        slug: "2026-08-12-react-at-acme",
        platform: "x",
        url: "https://x.com/i/status/2105474023287341382",
        author_name: "Andre Landgraf",
        author_handle: "andrelandgraf",
        author_url: "https://x.com/andrelandgraf",
        author_avatar_source_url:
          "https://pbs.twimg.com/profile_images/1971260572223275016/FG_T-KCm_200x200.jpg",
        posted_at: new Date("2026-10-01T01:44:59Z"),
        text: "Effect 4.0 shipped IRL! 🔥",
        image_source_url:
          "https://pbs.twimg.com/media/HTgldrIaQAEgAXJ.jpg?name=orig",
        image: null,
        author_avatar: null,
        status: "approved",
      },
    ]);
  });

  test("adding a post again changes nothing and asks no one, even a hidden one", async () => {
    const db = await database();
    await add(db, "2026-08-12-react-at-acme", xUrl);
    await db.exec(`UPDATE event_posts SET status = 'hidden'`);
    const before = await rows(db);
    const { exit, requests } = await add(
      db,
      "2025-12-02-café-night",
      "https://twitter.com/andrelandgraf/status/2105474023287341382",
    );
    expect(exit).toMatchObject(
      Exit.succeed({
        _tag: "Exists",
        eventSlug: "2026-08-12-react-at-acme",
        status: "hidden",
      }),
    );
    expect(requests).toEqual([]);
    expect(await rows(db)).toEqual(before);
  });

  test("a Bluesky handle URL is recognized once its DID is known", async () => {
    const db = await database();
    await add(db, "2026-08-12-react-at-acme", blueskyUrl);
    const { exit } = await add(db, "2026-08-12-react-at-acme", blueskyUrl);
    expect(exit).toMatchObject(Exit.succeed({ _tag: "Exists" }));
    // By DID, no lookup is needed.
    const byDid = await add(
      db,
      "2026-08-12-react-at-acme",
      `https://bsky.app/profile/${blueskyDid}/post/3lp5q7rcqnk2v`,
    );
    expect(byDid.requests).toEqual([]);
    expect(await rows(db)).toHaveLength(1);
  });

  test("a post another writer adds at the same moment is reported, not failed", async () => {
    const db = await database();
    // Stand in for a concurrent writer: the first insert of a post adds the
    // same post itself, hidden, just before this one lands.
    await db.exec(`
      CREATE FUNCTION race() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth() = 1 THEN
          INSERT INTO event_posts (event_id, platform, url, author_name,
            posted_at, text, status, updated_at)
          VALUES (NEW.event_id, NEW.platform, NEW.url, 'Someone else',
            NEW.posted_at, NEW.text, 'hidden', now());
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER race BEFORE INSERT ON event_posts
        FOR EACH ROW EXECUTE FUNCTION race();
    `);
    const { exit } = await add(db, "2026-08-12-react-at-acme", xUrl);
    expect(exit).toMatchObject(
      Exit.succeed({
        _tag: "Exists",
        url: "https://x.com/i/status/2105474023287341382",
        eventSlug: "2026-08-12-react-at-acme",
        status: "hidden",
      }),
    );
    expect(await rows(db)).toHaveLength(1);
  });

  test("a dry run reads the post and writes nothing", async () => {
    const db = await database();
    const { exit } = await add(db, "2026-08-12-react-at-acme", xUrl, {
      dryRun: true,
    });
    expect(exit).toMatchObject(Exit.succeed({ _tag: "WouldAdd" }));
    expect(await rows(db)).toEqual([]);
  });

  test("an unknown event stops before asking anyone", async () => {
    const db = await database();
    const { exit, requests } = await add(db, "no-such-event", xUrl);
    expect(exit).toEqual(
      Exit.fail(new PostEventNotFound({ slug: "no-such-event" })),
    );
    expect(requests).toEqual([]);
  });
});

describe("core/backfill/posts.json", () => {
  test("decodes; every post has a note and a URL it can read", async () => {
    const entries = Schema.decodeUnknownSync(
      Schema.fromJsonString(BackfillFile),
    )(
      await Bun.file(new URL("../backfill/posts.json", import.meta.url)).text(),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(parsePostUrl(entry.url)).not.toBeNull();
    }
    const urls = entries.map((e) => canonicalUrl(parsePostUrl(e.url)!));
    expect(new Set(urls).size).toBe(urls.length);
  });
});
