import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit } from "effect";
import {
  applyHostLinks,
  decodeHostLinksFile,
  HostLinksError,
  type HostLinksFile,
} from "../src/host-links.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Applying hosting companies' sourced links: against tests/seed.sql, where
 * Acme has a site and an X handle and Globex has none, and the file this
 * branch carries, which must decode.
 */

const source = "https://globex.example/";

const file: HostLinksFile = [
  {
    name: "Globex",
    website: { value: "https://globex.example", source },
    twitterHandle: { value: "globex", source },
    linkedinHandle: { value: "globex-corp", source },
    held: [
      {
        field: "blueskyHandle",
        value: "globex.bsky.social",
        sources: ["https://bsky.app/profile/globex.bsky.social"],
        reason: "not linked from the site",
      },
    ],
  },
  // Acme's X handle is already the file's; only its Bluesky is new.
  {
    name: "Acme",
    twitterHandle: { value: "acme", source },
    blueskyHandle: { value: "acme.example", source },
  },
];

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

const fresh = async () => {
  const db = await seededDatabase();
  databases.push(db);
  return db;
};

const apply = (db: PGlite, links: HostLinksFile, dryRun = false) =>
  Effect.runPromiseExit(
    applyHostLinks(links, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const hostsIn = async (db: PGlite) =>
  (
    await db.query<Record<string, string | null>>(
      `SELECT name, website_url, twitter_handle, bluesky_handle, linkedin_handle
       FROM sponsors ORDER BY name`,
    )
  ).rows;

describe("applyHostLinks", () => {
  test("sets each sourced fact, keeps what the file doesn't name, and never writes a held one", async () => {
    const db = await fresh();
    const exit = await apply(db, file);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      "held: Globex blueskyHandle globex.bsky.social: not linked from the site",
      "Globex: website_url ∅ → https://globex.example, twitter_handle ∅ → globex, linkedin_handle ∅ → globex-corp",
      "Acme: bluesky_handle ∅ → acme.example",
    ]);
    expect(await hostsIn(db)).toEqual([
      {
        name: "Acme",
        website_url: "https://acme.example",
        twitter_handle: "acme",
        bluesky_handle: "acme.example",
        linkedin_handle: null,
      },
      {
        name: "Globex",
        website_url: "https://globex.example",
        twitter_handle: "globex",
        bluesky_handle: null,
        linkedin_handle: "globex-corp",
      },
    ]);
  });

  test("is safe to repeat", async () => {
    const db = await fresh();
    await apply(db, file);
    const again = await apply(db, file);
    expect(Exit.isSuccess(again) ? again.value : again).toEqual([
      "held: Globex blueskyHandle globex.bsky.social: not linked from the site",
      "Globex: unchanged",
      "Acme: unchanged",
    ]);
  });

  test("a dry run reports everything and writes nothing", async () => {
    const db = await fresh();
    const before = await hostsIn(db);
    const exit = await apply(db, file, true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await hostsIn(db)).toEqual(before);
  });

  test("adds a company it doesn't hold when the file says what it does, with its Luma account", async () => {
    const db = await fresh();
    const exit = await apply(db, [
      {
        name: "Initech",
        about: { value: "Software, mostly TPS reports.", source },
        website: { value: "https://initech.example", source },
        lumaUserId: {
          value: "usr-initech1",
          source: "https://luma.com/user/usr-initech1",
        },
      },
      { name: "Acme", lumaUserId: { value: "usr-acme1", source } },
    ]);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      "Initech: added",
      "Initech: website_url ∅ → https://initech.example, luma_user_id ∅ → usr-initech1",
      "Acme: luma_user_id ∅ → usr-acme1",
    ]);
    const rows = (
      await db.query<{
        name: string;
        about: string;
        luma_user_id: string | null;
      }>(
        `SELECT name, about, luma_user_id FROM sponsors WHERE name IN ('Initech', 'Acme') ORDER BY name`,
      )
    ).rows;
    expect(rows).toEqual([
      { name: "Acme", about: expect.any(String), luma_user_id: "usr-acme1" },
      {
        name: "Initech",
        about: "Software, mostly TPS reports.",
        luma_user_id: "usr-initech1",
      },
    ]);
    // One company per Luma account.
    expect(
      Exit.isFailure(
        await apply(db, [
          { name: "Globex", lumaUserId: { value: "usr-acme1", source } },
        ]),
      ),
    ).toBe(true);
  });

  test("writes nothing when a host isn't stored, is listed twice, or a fact is both held and set", async () => {
    const db = await fresh();
    const before = await hostsIn(db);
    for (const [links, reason] of [
      [
        [
          ...file,
          { name: "Initech", website: { value: "https://i.example", source } },
        ],
        'No hosting company is stored as "Initech", and the file gives no about to add it with.',
      ],
      [[...file, { name: "Acme" }], "Hosts listed more than once: Acme"],
      [
        [
          {
            name: "Acme",
            blueskyHandle: { value: "acme.example", source },
            held: [
              {
                field: "blueskyHandle",
                value: "acme.example",
                sources: [source],
                reason: "unsure",
              },
            ],
          },
        ],
        "Facts both held and set (drop one): Acme blueskyHandle",
      ],
      [
        [
          {
            name: "Initech",
            about: { value: "Unconfirmed.", source },
            held: [
              {
                field: "about",
                value: "Unconfirmed.",
                sources: [source],
                reason: "not on its own site",
              },
            ],
          },
        ],
        "Facts both held and set (drop one): Initech about",
      ],
      [
        [
          {
            name: "Initech",
            held: [
              {
                field: "about",
                value: "Unconfirmed.",
                sources: [source],
                reason: "not on its own site",
              },
            ],
          },
        ],
        'No hosting company is stored as "Initech", and the file gives no about to add it with.',
      ],
    ] as const) {
      const exit = await apply(db, links);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons
          .map((part) => ("error" in part ? part.error : undefined))
          .find((e) => e !== undefined);
        expect(error).toBeInstanceOf(HostLinksError);
        expect((error as HostLinksError).reason).toBe(reason);
      }
    }
    expect(await hostsIn(db)).toEqual(before);
  });

  test("the database refuses a value of the wrong shape", async () => {
    const db = await fresh();
    for (const statement of [
      `UPDATE sponsors SET website_url = 'http://acme.example' WHERE name = 'Acme'`,
      `UPDATE sponsors SET twitter_handle = '@acme' WHERE name = 'Acme'`,
      `UPDATE sponsors SET bluesky_handle = 'Acme' WHERE name = 'Acme'`,
      `UPDATE sponsors SET linkedin_handle = 'company/acme' WHERE name = 'Acme'`,
    ]) {
      await expect(db.exec(statement)).rejects.toThrow(
        /violates check constraint/,
      );
    }
  });
});

describe("decodeHostLinksFile", () => {
  test("refuses a field it doesn't know, such as a misspelled one", async () => {
    const exit = await Effect.runPromiseExit(
      decodeHostLinksFile(
        JSON.stringify([
          {
            name: "Acme",
            websiteUrl: { value: "https://acme.example", source },
          },
        ]),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("backfill/hosts.json", () => {
  test("decodes: every fact has a source, every value its column's shape", async () => {
    const text = await Bun.file(
      new URL("../backfill/hosts.json", import.meta.url),
    ).text();
    const links = await Effect.runPromise(decodeHostLinksFile(text));
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links.map((entry) => entry.name)).size).toBe(links.length);
  });
});
