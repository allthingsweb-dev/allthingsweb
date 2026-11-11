import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit } from "effect";
import type { Now } from "../src/now.ts";
import type { XPosts } from "../src/x-posts.ts";
import { profilePhotoHosts } from "../src/ingest/remote.ts";
import {
  applyPeople,
  decodePeopleFile,
  type PeopleFile,
  PeopleEnrichmentError,
  photoHosts,
  postIdOf,
} from "../src/people-enrichment.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Filling profiles from sourced facts: against tests/seed.sql, where Ada
 * has a title, handles and a photo, Grace has a title but no bio, handles
 * or photo (and a LinkedIn handle with a space), and Linus has no title.
 */

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const linus = "b0000000-0000-4000-8000-000000000003";
const read = "2026-10-05";
const source = "https://example.com/about";

const file: PeopleFile = [
  {
    profileId: grace,
    name: "Grace Hopper",
    bio: { value: "Grace Hopper wrote the first compiler.", source, read },
    twitterHandle: { value: "grace", source, read },
    photoSourceUrl: {
      value: "https://avatars.githubusercontent.com/u/2",
      source,
      read,
    },
    held: [
      {
        field: "blueskyHandle",
        value: "grace.bsky.social",
        sources: ["https://bsky.app/profile/grace.bsky.social"],
        reason: "same name, no link to her",
      },
    ],
  },
  {
    profileId: linus,
    name: "Linus",
    title: { value: "Maintainer", source, read },
  },
  // Ada's title is filled, so the file's never replaces it.
  {
    profileId: ada,
    name: "Ada Lovelace",
    title: { value: "Mathematician", source, read },
  },
];

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

const fresh = async () => {
  const db = await seededDatabase();
  databases.push(db);
  return db;
};

const apply = (db: PGlite, people: PeopleFile, dryRun = false) =>
  Effect.runPromiseExit(
    applyPeople(people, dryRun).pipe(
      Effect.provide(sqlLayer(db)),
      // Today, as the test clock has it: 2026-10-03.
      Effect.provide(clockLayer),
    ),
  );

const profilesIn = async (db: PGlite) =>
  (
    await db.query<Record<string, string | null>>(
      `SELECT name, title, bio, twitter_handle, bluesky_handle, linkedin_handle, photo_source_url
       FROM profiles WHERE id IN ('${ada}', '${grace}', '${linus}') ORDER BY name`,
    )
  ).rows;

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons
        .map((part) => ("error" in part ? part.error : undefined))
        .find((error) => error !== undefined)
    : undefined;

describe("applyPeople", () => {
  test("fills only what is blank, never writes a held fact, and says what it kept", async () => {
    const db = await fresh();
    const exit = await apply(db, file);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      "held: Grace Hopper blueskyHandle: same name, no link to her",
      "Grace Hopper: bio ← Grace Hopper wrote the first compiler., twitter_handle ← grace, photo_source_url ← https://avatars.githubusercontent.com/u/2",
      "Linus: title ← Maintainer",
      'Ada Lovelace: title kept (already "Engineer")',
    ]);
    expect(await profilesIn(db)).toEqual([
      {
        name: "Ada Lovelace",
        title: "Engineer",
        bio: "Writes compilers.",
        twitter_handle: "ada",
        bluesky_handle: "ada.bsky.social",
        linkedin_handle: "ada-lovelace",
        photo_source_url: null,
      },
      {
        name: "Grace Hopper",
        title: "Admiral",
        bio: "Grace Hopper wrote the first compiler.",
        twitter_handle: "grace",
        bluesky_handle: null,
        linkedin_handle: "grace hopper",
        photo_source_url: "https://avatars.githubusercontent.com/u/2",
      },
      {
        name: "Linus",
        title: "Maintainer",
        bio: "Kernel.",
        twitter_handle: "@linus",
        bluesky_handle: null,
        linkedin_handle: null,
        photo_source_url: null,
      },
    ]);
  });

  test("replaces a filled value only while it is still the stale one the file names", async () => {
    const db = await fresh();
    const stale = (was: string) => [
      {
        profileId: ada,
        name: "Ada Lovelace",
        title: { value: "Mathematician", source, read, was },
      },
    ];
    const kept = await apply(db, stale("Countess"));
    expect(Exit.isSuccess(kept) ? kept.value : kept).toEqual([
      'Ada Lovelace: title kept (already "Engineer")',
    ]);
    const replaced = await apply(db, stale("Engineer"));
    expect(Exit.isSuccess(replaced) ? replaced.value : replaced).toEqual([
      'Ada Lovelace: title "Engineer" → Mathematician',
    ]);
    const again = await apply(db, stale("Engineer"));
    expect(Exit.isSuccess(again) ? again.value : again).toEqual([
      "Ada Lovelace: unchanged",
    ]);
  });

  test("never replaces the photo source of a profile whose image is copied, even when it names the stale one", async () => {
    const db = await fresh();
    await db.exec(
      `UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1' WHERE id = '${ada}'`,
    );
    const exit = await apply(db, [
      {
        profileId: ada,
        name: "Ada Lovelace",
        photoSourceUrl: {
          value: "https://avatars.githubusercontent.com/u/2",
          source,
          read,
          was: "https://avatars.githubusercontent.com/u/1",
        },
      },
    ]);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      // Kept values are quoted to their first 40 characters.
      'Ada Lovelace: photo_source_url kept (already "https://avatars.githubusercontent.com/u/")',
    ]);
  });

  test("never sets a photo source beside a copied image, even where its source column is blank", async () => {
    const db = await fresh();
    await db.exec(
      `UPDATE profiles SET photo_source_url = '' WHERE id = '${ada}'`,
    );
    const exit = await apply(db, [
      {
        profileId: ada,
        name: "Ada Lovelace",
        photoSourceUrl: {
          value: "https://avatars.githubusercontent.com/u/2",
          source,
          read,
        },
      },
    ]);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      'Ada Lovelace: photo_source_url kept (already "(image)")',
    ]);
  });

  test("a handle stored as an empty string counts as blank", async () => {
    const db = await fresh();
    await db.exec(
      `UPDATE profiles SET linkedin_handle = '' WHERE id = '${linus}'`,
    );
    const exit = await apply(db, [
      {
        profileId: linus,
        name: "Linus",
        linkedinHandle: { value: "linus-torvalds", source, read },
      },
    ]);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      "Linus: linkedin_handle ← linus-torvalds",
    ]);
  });

  test("never sets a photo source for a profile that has its image", async () => {
    const db = await fresh();
    const exit = await apply(db, [
      {
        profileId: ada,
        name: "Ada Lovelace",
        photoSourceUrl: {
          value: "https://avatars.githubusercontent.com/u/1",
          source,
          read,
        },
      },
    ]);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      'Ada Lovelace: photo_source_url kept (already "(image)")',
    ]);
  });

  test("is safe to repeat", async () => {
    const db = await fresh();
    await apply(db, file);
    const again = await apply(db, file);
    expect(Exit.isSuccess(again) ? again.value : again).toEqual([
      "held: Grace Hopper blueskyHandle: same name, no link to her",
      "Grace Hopper: unchanged",
      "Linus: unchanged",
      'Ada Lovelace: title kept (already "Engineer")',
    ]);
  });

  test("a dry run reports everything and writes nothing", async () => {
    const db = await fresh();
    const before = await profilesIn(db);
    const exit = await apply(db, file, true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await profilesIn(db)).toEqual(before);
  });

  test("writes nothing for an unknown profile, a name that no longer matches, a profile listed twice, or a fact both held and set", async () => {
    const db = await fresh();
    const before = await profilesIn(db);
    for (const [people, reason] of [
      [
        [
          ...file,
          { profileId: "b0000000-0000-4000-8000-000000000099", name: "Nobody" },
        ],
        "No profile has the id b0000000-0000-4000-8000-000000000099.",
      ],
      [
        [
          ...file,
          {
            profileId: "b0000000-0000-4000-8000-000000000005",
            name: "Someone Else",
          },
        ],
        'Profile b0000000-0000-4000-8000-000000000005 is named "Future Speaker", not "Someone Else".',
      ],
      [
        [...file, { profileId: linus, name: "Linus" }],
        `Profiles listed more than once: ${linus}`,
      ],
      [
        [
          {
            profileId: linus,
            name: "Linus",
            title: { value: "Maintainer", source, read },
            held: [
              {
                field: "title",
                value: "Maintainer",
                sources: [source],
                reason: "unsure",
              },
            ],
          },
        ],
        "Facts both held and set (drop one): Linus title",
      ],
    ] as const) {
      const error = failureOf(await apply(db, people));
      expect(error).toBeInstanceOf(PeopleEnrichmentError);
      expect((error as PeopleEnrichmentError).reason).toBe(reason);
    }
    expect(await profilesIn(db)).toEqual(before);
  });
});

describe("applyPeople: now", () => {
  const now: Now = {
    line: "Linus [maintains the kernel](https://kernel.example/maintainers).",
    links: [
      {
        title: "Release notes",
        date: "2026-10-01",
        url: "https://kernel.example/notes",
        kind: "post",
      },
    ],
    checkedOn: "2026-10-01",
  };
  const later: Now = {
    ...now,
    line: "Linus [still maintains the kernel](https://kernel.example/maintainers).",
    checkedOn: "2026-10-03",
  };
  const withNow = (value: Now | null | undefined) => [
    {
      profileId: linus,
      name: "Linus",
      ...(value === undefined ? {} : { now: value }),
      held: [
        {
          field: "now" as const,
          value: "Linus moved.",
          sources: [source],
          reason: "personal",
        },
      ],
    },
  ];
  const stored = async (db: PGlite) =>
    (
      await db.query<{ now_record: unknown }>(
        `SELECT now_record FROM profiles WHERE id = '${linus}'`,
      )
    ).rows[0]?.now_record;
  const linesOf = (exit: Exit.Exit<ReadonlyArray<string>, unknown>) =>
    Exit.isSuccess(exit) ? exit.value : exit;

  test("writes a record, keeps a held claim beside it, and is safe to repeat", async () => {
    const db = await fresh();
    expect(linesOf(await apply(db, withNow(now)))).toEqual([
      "held: Linus now: personal",
      "Linus: now ← as of 2026-10-01",
    ]);
    expect(await stored(db)).toEqual(now);
    expect(linesOf(await apply(db, withNow(now)))).toEqual([
      "held: Linus now: personal",
      "Linus: unchanged",
    ]);
  });

  test("replaces a record with the file's whenever they differ", async () => {
    const db = await fresh();
    await apply(db, withNow(now));
    expect(linesOf(await apply(db, withNow(later)))).toEqual([
      "held: Linus now: personal",
      "Linus: now 2026-10-01 → 2026-10-03",
    ]);
    expect(await stored(db)).toEqual(later);
  });

  test("null takes it down, and an entry without now leaves it", async () => {
    const db = await fresh();
    await apply(db, withNow(now));
    expect(linesOf(await apply(db, withNow(undefined)))).toEqual([
      "held: Linus now: personal",
      "Linus: unchanged",
    ]);
    expect(await stored(db)).toEqual(now);
    expect(linesOf(await apply(db, withNow(null)))).toEqual([
      "held: Linus now: personal",
      "Linus: now cleared",
    ]);
    expect(await stored(db)).toBeNull();
    expect(linesOf(await apply(db, withNow(null)))).toEqual([
      "held: Linus now: personal",
      "Linus: unchanged",
    ]);
  });

  test("a dry run writes no record", async () => {
    const db = await fresh();
    const exit = await apply(db, withNow(now), true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await stored(db)).toBeNull();
  });

  test("refuses a record checked after today, and writes nothing", async () => {
    const db = await fresh();
    const error = failureOf(
      await apply(db, withNow({ ...later, checkedOn: "2026-10-04" })),
    );
    expect(error).toBeInstanceOf(PeopleEnrichmentError);
    expect((error as PeopleEnrichmentError).reason).toBe(
      "Now records checked after today, 2026-10-03: Linus (2026-10-04)",
    );
    expect(await stored(db)).toBeNull();
  });

  test("the column takes only an object", async () => {
    const db = await fresh();
    await expect(
      db.exec(
        `UPDATE profiles SET now_record = '"Linus"' WHERE id = '${linus}'`,
      ),
    ).rejects.toThrow(/profiles_now_record_check/);
  });
});

describe("applyPeople: xPosts", () => {
  const post = (id: string, postedOn: string, handle = "ada") => ({
    url: `https://x.com/${handle}/status/${id}`,
    postedOn,
    excerpt: "The engine weaves algebraic patterns.",
    likes: 1200,
    reposts: 80,
    replies: 12,
  });
  const record: XPosts = {
    posts: [
      post("2000000000000000002", "2026-10-01"),
      post("2000000000000000001", "2026-09-30"),
    ],
    readOn: "2026-10-02",
  };
  const withPosts = (value: XPosts | null | undefined): PeopleFile => [
    {
      profileId: ada,
      name: "Ada Lovelace",
      ...(value === undefined ? {} : { xPosts: value }),
    },
  ];
  const stored = async (db: PGlite, id = ada) =>
    (
      await db.query<{ x_posts: unknown }>(
        `SELECT x_posts FROM profiles WHERE id = '${id}'`,
      )
    ).rows[0]?.x_posts;
  const linesOf = (exit: Exit.Exit<ReadonlyArray<string>, unknown>) =>
    Exit.isSuccess(exit) ? exit.value : exit;
  const reasonOf = (exit: Exit.Exit<ReadonlyArray<string>, unknown>) => {
    const error = failureOf(exit);
    expect(error).toBeInstanceOf(PeopleEnrichmentError);
    return (error as PeopleEnrichmentError).reason;
  };

  test("writes them, is safe to repeat, replaces them when they differ, and null takes them down", async () => {
    const db = await fresh();
    expect(linesOf(await apply(db, withPosts(record)))).toEqual([
      "Ada Lovelace: x posts ← 2 posts, read 2026-10-02",
    ]);
    expect(await stored(db)).toEqual(record);
    expect(linesOf(await apply(db, withPosts(record)))).toEqual([
      "Ada Lovelace: unchanged",
    ]);
    const refreshed = {
      posts: [{ ...record.posts[0]!, likes: 1300 }],
      readOn: "2026-10-03",
    };
    expect(linesOf(await apply(db, withPosts(refreshed)))).toEqual([
      "Ada Lovelace: x posts → 1 post, read 2026-10-03",
    ]);
    expect(linesOf(await apply(db, withPosts(undefined)))).toEqual([
      "Ada Lovelace: unchanged",
    ]);
    expect(await stored(db)).toEqual(refreshed);
    expect(linesOf(await apply(db, withPosts(null)))).toEqual([
      "Ada Lovelace: x posts cleared",
    ]);
    expect(await stored(db)).toBeNull();
  });

  test("a dry run writes none", async () => {
    const db = await fresh();
    await apply(db, withPosts(record), true);
    expect(await stored(db)).toBeNull();
  });

  test("takes posts by the handle the same entry sets, or the stored one with its @", async () => {
    const db = await fresh();
    expect(
      linesOf(
        await apply(db, [
          {
            profileId: linus,
            name: "Linus",
            xPosts: {
              posts: [post("5", "2026-10-01", "Linus")],
              readOn: "2026-10-02",
            },
          },
        ]),
      ),
    ).toEqual(["Linus: x posts ← 1 post, read 2026-10-02"]);
    const exit = await apply(db, [
      {
        profileId: grace,
        name: "Grace Hopper",
        twitterHandle: { value: "Grace", source, read },
        xPosts: {
          posts: [post("3", "2026-10-01", "grace")],
          readOn: "2026-10-02",
        },
      },
    ]);
    expect(linesOf(exit)).toEqual([
      "Grace Hopper: twitter_handle ← Grace, x posts ← 1 post, read 2026-10-02",
    ]);
  });

  test("refuses posts by another handle, read after today, or also linked from now, and writes nothing", async () => {
    const db = await fresh();
    expect(
      reasonOf(
        await apply(
          db,
          withPosts({
            posts: [post("4", "2026-10-01", "grace")],
            readOn: "2026-10-02",
          }),
        ),
      ),
    ).toBe(
      "Ada Lovelace's X posts aren't by their X handle (@ada): https://x.com/grace/status/4",
    );
    expect(
      reasonOf(await apply(db, withPosts({ ...record, readOn: "2026-10-04" }))),
    ).toBe("X posts read after today, 2026-10-03: Ada Lovelace (2026-10-04)");
    expect(
      reasonOf(
        await apply(db, [
          {
            ...withPosts(record)[0]!,
            now: {
              line: "Ada [writes compilers](https://ada.example).",
              links: [
                {
                  title: "On the engine",
                  date: "2026-10-01",
                  url: "https://twitter.com/ada/status/2000000000000000002?s=20",
                  kind: "post",
                },
              ],
              checkedOn: "2026-10-02",
            },
          },
        ]),
      ),
    ).toBe(
      "X posts also linked from now (keep one): Ada Lovelace https://x.com/ada/status/2000000000000000002",
    );
    expect(await stored(db)).toBeNull();
  });

  test("checks what is stored too: a new handle against stored posts, and posts against a stored now, and the other way", async () => {
    const db = await fresh();
    await apply(db, withPosts(record));
    expect(
      reasonOf(
        await apply(db, [
          {
            profileId: ada,
            name: "Ada Lovelace",
            twitterHandle: { value: "lovelace", source, read, was: "ada" },
          },
        ]),
      ),
    ).toBe(
      "Ada Lovelace's X posts aren't by their X handle (@lovelace): https://x.com/ada/status/2000000000000000002, https://x.com/ada/status/2000000000000000001 (stored; set xPosts to null or to posts by the new handle)",
    );
    const linking = {
      line: "Ada [writes compilers](https://ada.example).",
      links: [
        {
          title: "On the engine",
          date: "2026-10-01",
          url: "https://X.com/ada/status/2000000000000000002",
          kind: "post" as const,
        },
      ],
      checkedOn: "2026-10-02",
    };
    expect(
      reasonOf(
        await apply(db, [
          { profileId: ada, name: "Ada Lovelace", now: linking },
        ]),
      ),
    ).toBe(
      "X posts also linked from now (keep one): Ada Lovelace https://x.com/ada/status/2000000000000000002",
    );
    // A post its line cites counts too, whatever case its host is written in.
    expect(
      reasonOf(
        await apply(db, [
          {
            profileId: ada,
            name: "Ada Lovelace",
            now: {
              ...linking,
              line: "Ada [wrote about the engine](https://www.Twitter.com/ada/status/2000000000000000001?s=20).",
              links: [],
            },
          },
        ]),
      ),
    ).toBe(
      "X posts also linked from now (keep one): Ada Lovelace https://x.com/ada/status/2000000000000000001",
    );
    await apply(db, withPosts(null));
    await apply(db, [{ profileId: ada, name: "Ada Lovelace", now: linking }]);
    expect(reasonOf(await apply(db, withPosts(record)))).toBe(
      "X posts also linked from now (keep one): Ada Lovelace https://x.com/ada/status/2000000000000000002",
    );
  });

  test("the column takes only an object", async () => {
    const db = await fresh();
    await expect(
      db.exec(`UPDATE profiles SET x_posts = '[]' WHERE id = '${ada}'`),
    ).rejects.toThrow(/profiles_x_posts_check/);
  });
});

describe("postIdOf", () => {
  test("reads a post's id from every form X links it in, and nothing else", () => {
    for (const url of [
      "https://x.com/ada/status/123",
      "https://X.com/ada/status/123?s=20",
      "https://www.twitter.com/ada/status/123/photo/1",
      "https://mobile.twitter.com/ada/status/123",
      "https://x.com/i/status/123",
      "https://x.com/i/web/status/123#reply",
    ]) {
      expect(postIdOf(url)).toBe("123");
    }
    for (const url of [
      "https://x.com/ada",
      "https://x.com/ada/status/123abc",
      "https://notx.com/ada/status/123",
      "http://x.com/ada/status/123",
    ]) {
      expect(postIdOf(url)).toBeUndefined();
    }
  });
});

describe("decodePeopleFile", () => {
  const decodes = async (entry: object) =>
    Exit.isSuccess(
      await Effect.runPromiseExit(decodePeopleFile(JSON.stringify([entry]))),
    );
  const base = { profileId: linus, name: "Linus" };

  test("takes a sourced, dated fact", async () => {
    expect(
      await decodes({ ...base, title: { value: "Maintainer", source, read } }),
    ).toBe(true);
  });

  test("takes the other pages a fact drew on, and the organizer's instruction it was written on", async () => {
    const bio = { value: "Linus maintains the kernel.", source, read };
    const askedBy = { who: "Erik", on: read, said: "Do a best attempt." };
    expect(
      await decodes({
        ...base,
        bio: { ...bio, also: ["https://kernel.example/about"], askedBy },
      }),
    ).toBe(true);
    // Each is held to its shape: pages are https, the day a real date, and
    // no part of either is left empty.
    for (const wrong of [
      { also: [] },
      { also: ["http://kernel.example/about"] },
      { askedBy: { ...askedBy, on: "Nov 5" } },
      { askedBy: { ...askedBy, said: "" } },
      { askedBy: { who: "Erik", on: read } },
      { askedBy: { ...askedBy, via: "chat" } },
    ]) {
      expect(await decodes({ ...base, bio: { ...bio, ...wrong } })).toBe(false);
    }
  });

  test("refuses an unknown field, a fact without its day, a photo from elsewhere, and padded text", async () => {
    expect(
      await decodes({
        ...base,
        website: { value: "https://l.example", source, read },
      }),
    ).toBe(false);
    expect(
      await decodes({ ...base, title: { value: "Maintainer", source } }),
    ).toBe(false);
    expect(
      await decodes({
        ...base,
        photoSourceUrl: {
          value: "https://cdn.example/linus.jpg",
          source,
          read,
        },
      }),
    ).toBe(false);
    expect(
      await decodes({ ...base, bio: { value: " Kernel. ", source, read } }),
    ).toBe(false);
    expect(
      await decodes({
        ...base,
        twitterHandle: { value: "@linus", source, read },
      }),
    ).toBe(false);
    expect(
      await decodes({
        ...base,
        now: {
          line: "Linus maintains the kernel.",
          links: [],
          checkedOn: read,
        },
      }),
    ).toBe(false);
  });
});

describe("photo hosts", () => {
  test("are the hosts the sync's image ingestion copies from", () => {
    expect([...photoHosts].toSorted()).toEqual(
      [...profilePhotoHosts].toSorted(),
    );
  });
});

describe("backfill/people.json", () => {
  test("decodes: every fact sourced and dated, each profile once", async () => {
    const text = await Bun.file(
      new URL("../backfill/people.json", import.meta.url),
    ).text();
    const people = await Effect.runPromise(decodePeopleFile(text));
    expect(people.length).toBeGreaterThan(0);
    expect(new Set(people.map((entry) => entry.profileId)).size).toBe(
      people.length,
    );
  });
});
