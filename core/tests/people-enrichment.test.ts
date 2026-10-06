import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit } from "effect";
import { profilePhotoHosts } from "../../app/src/lib/profile-photos/hosts.ts";
import {
  applyPeople,
  decodePeopleFile,
  type PeopleFile,
  PeopleEnrichmentError,
  photoHosts,
} from "../src/people-enrichment.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

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
    applyPeople(people, dryRun).pipe(Effect.provide(sqlLayer(db))),
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
  });
});

describe("photo hosts", () => {
  test("are the hosts the app's hourly ingestion copies from", () => {
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
