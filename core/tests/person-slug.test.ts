import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  fallbackSlug,
  personSlug,
  slugLength,
  slugPattern,
} from "../src/person-slug.ts";
import { Effect } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { migrations } from "../migrations/index.ts";
import * as Migrations from "../src/migrator.ts";
import { migratedDatabase, sqlLayer } from "./support/database.ts";

/**
 * A person's slug: the database's person_slug() and core's personSlug()
 * agree, and the trigger keeps every profile's slug, unique and from the
 * name, with the old ones for redirects.
 */

const db: PGlite = await migratedDatabase();
afterAll(() => db.close());

const sqlSlug = async (name: string): Promise<string> =>
  (
    await db.query<{ slug: string }>("SELECT public.person_slug($1) AS slug", [
      name,
    ])
  ).rows[0]?.slug ?? "";

/** Names as people write them, and the cases the rules name. */
const names = [
  "Erik Thorelli",
  "Andre Landgraf",
  "Michael Arnaldi",
  "Rostislav Melkumyan",
  "Ivan Burazin",
  "Kit Langton",
  "Sebastian Lorenz",
  "José Valim",
  "Zoë Rämö-Søndergaard",
  "Łukasz Jagiełło",
  "Ðorđe Šćepanović",
  "Straße & Æsir: Œuvre Þing",
  "  O'Brien, Jr.  ",
  "dex 🦀",
  "李小龙",
  "Ivan & the 2 Bots",
  "àáâãäåāăąçćčďđèéêëēĕėęěìíîïĩīįıłñńňòóôõöøōőŕřśšşťùúûüũūůűųýÿźżž",
  "ÀÁÂÃÄÅĀĂĄÇĆČĎĐÈÉÊËĒĔĖĘĚÌÍÎÏĨĪĮŁÑŃŇÒÓÔÕÖØŌŐŔŘŚŠŞŤÙÚÛÜŨŪŮŰŲÝŸŹŻŽ",
  "a".repeat(80) + " b",
  "---",
  "",
];

describe("a name as a slug", () => {
  test("is the same in core and in the database", async () => {
    for (const name of names) {
      expect([name, personSlug(name)]).toEqual([name, await sqlSlug(name)]);
    }
  });

  test("is lowercase words joined by hyphens, plain letters for marked ones", () => {
    expect(personSlug("Erik Thorelli")).toBe("erik-thorelli");
    expect(personSlug("Zoë Rämö-Søndergaard")).toBe("zoe-ramo-sondergaard");
    expect(personSlug("Łukasz Jagiełło")).toBe("lukasz-jagiello");
    expect(personSlug("Straße & Æsir: Œuvre Þing")).toBe(
      "strasse-aesir-oeuvre-thing",
    );
    expect(personSlug("  O'Brien, Jr.  ")).toBe("o-brien-jr");
    expect(personSlug("dex 🦀")).toBe("dex");
  });

  test("is cut to its longest, and falls back when nothing is left", () => {
    expect(personSlug("a".repeat(80))).toHaveLength(slugLength);
    expect(personSlug("李小龙")).toBe(fallbackSlug);
    expect(personSlug("")).toBe(fallbackSlug);
    for (const name of names) expect(personSlug(name)).toMatch(slugPattern);
  });
});

const insert = async (name: string): Promise<{ id: string; slug: string }> => {
  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO profiles (name, title, bio, profile_type, updated_at)
      VALUES ($1, '', '', 'member', now()) RETURNING id, slug`,
    [name],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("no row");
  return row;
};

const rename = async (id: string, name: string): Promise<string> =>
  (
    await db.query<{ slug: string }>(
      "UPDATE profiles SET name = $2 WHERE id = $1 RETURNING slug",
      [id, name],
    )
  ).rows[0]?.slug ?? "";

const history = async (id: string): Promise<Array<string>> =>
  (
    await db.query<{ slug: string }>(
      "SELECT slug FROM profile_slugs WHERE profile_id = $1 ORDER BY slug",
      [id],
    )
  ).rows.map((row) => row.slug);

describe("a profile's slug", () => {
  test("comes from the name, numbered past one already taken", async () => {
    const first = await insert("Grace Hopper");
    const second = await insert("Grace  Hopper!");
    const third = await insert("grace hopper");
    expect([first.slug, second.slug, third.slug]).toEqual([
      "grace-hopper",
      "grace-hopper-2",
      "grace-hopper-3",
    ]);
  });

  test("follows a new name, retiring the old one for a redirect", async () => {
    const ada = await insert("Ada Byron");
    expect(await rename(ada.id, "Ada Lovelace")).toBe("ada-lovelace");
    expect(await history(ada.id)).toEqual(["ada-byron"]);
    // Nobody else gets the old address.
    expect((await insert("Ada Byron")).slug).toBe("ada-byron-2");
    // Not even Ada, taking the name back: a browser that cached the
    // redirect from ada-byron would loop.
    expect(await rename(ada.id, "Ada Byron")).toBe("ada-byron-3");
    expect(await history(ada.id)).toEqual(["ada-byron", "ada-lovelace"]);
  });

  test("stays when the name changes only in what the slug drops", async () => {
    const alan = await insert("Alan Turing");
    expect(await rename(alan.id, "ALAN  TURING")).toBe("alan-turing");
    expect(await history(alan.id)).toEqual([]);
  });

  test("may be set by hand, and must be a slug", async () => {
    const linus = await insert("Linus Torvalds");
    const { rows } = await db.query<{ slug: string }>(
      "UPDATE profiles SET slug = 'linus' WHERE id = $1 RETURNING slug",
      [linus.id],
    );
    expect(rows[0]?.slug).toBe("linus");
    expect(await history(linus.id)).toEqual(["linus-torvalds"]);
    await expect(
      db.query("UPDATE profiles SET slug = 'Not A Slug' WHERE id = $1", [
        linus.id,
      ]),
    ).rejects.toThrow(/profiles_slug_check/);
    // A retired slug is never set again, by hand either, even by its person.
    await expect(
      db.query("UPDATE profiles SET slug = 'linus-torvalds' WHERE id = $1", [
        linus.id,
      ]),
    ).rejects.toThrow(/is retired/);
    const other = await insert("Somebody Else");
    await expect(
      db.query("UPDATE profiles SET slug = 'linus-torvalds' WHERE id = $1", [
        other.id,
      ]),
    ).rejects.toThrow(/is retired/);
  });

  test("goes with its profile, old ones too", async () => {
    const gone = await insert("Temporary Person");
    await rename(gone.id, "Temporary Name");
    await db.query("DELETE FROM profiles WHERE id = $1", [gone.id]);
    expect(await history(gone.id)).toEqual([]);
  });
});

describe("the migration", () => {
  test("gives existing people their slugs oldest first, none shared", async () => {
    // Every migration before this one, whatever comes after it.
    const slugsId = Number(
      Object.keys(migrations)
        .find((id) => id.endsWith("_person_slugs"))
        ?.split("_")[0],
    );
    const before = Migrator.fromRecord(
      Object.fromEntries(
        Object.entries(migrations).filter(
          ([id]) => Number(id.split("_")[0]) < slugsId,
        ),
      ),
    );
    const old = await migratedDatabase(before);
    try {
      await old.exec(`
        INSERT INTO profiles (name, title, bio, profile_type, created_at, updated_at) VALUES
          ('Alice 2', '', '', 'member', '2024-01-01T00:00:00Z', now()),
          ('Alice', '', '', 'member', '2024-01-02T00:00:00Z', now()),
          ('ALICE!', '', '', 'member', '2024-01-03T00:00:00Z', now()),
          ('李', '', '', 'member', '2024-01-04T00:00:00Z', now());`);
      await Effect.runPromise(
        Migrations.run().pipe(Effect.provide(sqlLayer(old))),
      );
      const { rows } = await old.query<{ name: string; slug: string }>(
        "SELECT name, slug FROM profiles ORDER BY created_at",
      );
      expect(rows).toEqual([
        { name: "Alice 2", slug: "alice-2" },
        { name: "Alice", slug: "alice" },
        { name: "ALICE!", slug: "alice-3" },
        { name: "李", slug: "person" },
      ]);
      // Getting their slugs retired none.
      expect((await old.query("SELECT 1 FROM profile_slugs")).rows).toEqual([]);
    } finally {
      await old.close();
    }
  });
});
