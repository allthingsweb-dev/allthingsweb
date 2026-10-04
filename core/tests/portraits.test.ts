import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import { Portraits } from "../src/portraits.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Portraits against the migrated production schema: tests/seed.sql, where
 * Ada Lovelace has a photo and Grace Hopper has none, plus one profile whose
 * photo is on another origin.
 */

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const elsewhere = "b0000000-0000-4000-8000-000000000101";
const nobody = "b0000000-0000-4000-8000-0000000000ff";

const db = await seededDatabase();
await db.exec(`
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000101', 'https://elsewhere.example/people/eve.jpg', '', 'Eve', 300, 300, now());
  INSERT INTO profiles (id, name, title, image, bio, profile_type, updated_at) VALUES
    ('${elsewhere}', 'Eve Elsewhere', '', 'd0000000-0000-4000-8000-000000000101', '', 'organizer', now());
`);
afterAll(() => db.close());

const photoOrigin = "https://storage.example";

/** Portraits of `profileIds` on `origin`, read from `database`. */
const read = (
  profileIds: ReadonlyArray<string>,
  database: PGlite = db,
  origin = photoOrigin,
) =>
  Portraits.use((portraits) => portraits.read(profileIds, origin)).pipe(
    Effect.provide(Portraits.layer.pipe(Layer.provide(sqlLayer(database)))),
  );

describe("Portraits", () => {
  test("reads each profile's photo by id", async () => {
    const portraits = await Effect.runPromise(read([ada, grace]));
    expect([...portraits]).toEqual([
      [
        ada,
        {
          url: "https://storage.example/people/ada.jpg",
          alt: "Ada Lovelace",
          width: 400,
          height: 400,
        },
      ],
    ]);
  });

  test("has no entry for a profile without a photo, or that doesn't exist", async () => {
    const portraits = await Effect.runPromise(read([grace, nobody]));
    expect(portraits.size).toBe(0);
  });

  test("leaves out photos on any other origin", async () => {
    const portraits = await Effect.runPromise(read([ada, elsewhere]));
    expect([...portraits.keys()]).toEqual([ada]);
    const there = await Effect.runPromise(
      read([ada, elsewhere], db, "https://elsewhere.example"),
    );
    expect([...there.keys()]).toEqual([elsewhere]);
  });

  test("reads nothing for no ids", async () => {
    const empty = await PGlite.create();
    try {
      // The schema isn't there, so a query would fail.
      const portraits = await Effect.runPromise(read([], empty));
      expect(portraits.size).toBe(0);
    } finally {
      await empty.close();
    }
  });

  test("fails as DataSourceError when the database does", async () => {
    const empty = await PGlite.create();
    try {
      const error = await Effect.runPromise(Effect.flip(read([ada], empty)));
      expect(error).toBeInstanceOf(DataSourceError);
    } finally {
      await empty.close();
    }
  });
});
