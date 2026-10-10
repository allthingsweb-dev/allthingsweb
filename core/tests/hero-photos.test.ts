import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import file from "../backfill/hero-photos.json" with { type: "json" };
import wallFile from "../backfill/wall-photos.json" with { type: "json" };
import {
  type HeroPhoto,
  HeroPhotosFile,
  heroPhotoProblems,
  heroPhotos,
  repeated,
  wallPhotos,
} from "../src/hero-photos.ts";
import { wallLimit } from "../src/community.ts";
import { photoLimit } from "../src/home.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The hand-picked hero photos (core/backfill/hero-photos.json): the file
 * itself, and the check `bun run hero-photos` runs against production,
 * here against tests/seed.sql.
 */

describe("core/backfill/hero-photos.json", () => {
  test("decodes, and names each image once", () => {
    expect(Schema.decodeUnknownSync(HeroPhotosFile)(file).photos).toEqual(
      heroPhotos,
    );
    expect(repeated(heroPhotos)).toEqual([]);
  });

  test(`fills the mosaic's ${photoLimit} tiles`, () => {
    expect(heroPhotos.length).toBeGreaterThanOrEqual(photoLimit);
  });

  test("refuses an id that isn't a UUID, and an empty reason", () => {
    const decode = Schema.decodeUnknownExit(HeroPhotosFile);
    const photo = { image: heroPhotos[0]?.image, evening: "x", why: "y" };
    expect(decode({ photos: [photo] })._tag).toBe("Success");
    expect(decode({ photos: [{ ...photo, image: "42" }] })._tag).toBe(
      "Failure",
    );
    expect(decode({ photos: [{ ...photo, why: " " }] })._tag).toBe("Failure");
  });
});

describe("core/backfill/wall-photos.json", () => {
  test("decodes, and names each image once", () => {
    expect(Schema.decodeUnknownSync(HeroPhotosFile)(wallFile).photos).toEqual(
      wallPhotos,
    );
    expect(repeated(wallPhotos)).toEqual([]);
  });

  test("is a wall: about forty photos, from many evenings", () => {
    expect(wallPhotos.length).toBeGreaterThanOrEqual(36);
    expect(wallPhotos.length).toBeLessThanOrEqual(wallLimit);
    const evenings = new Set(wallPhotos.map((photo) => photo.evening));
    expect(evenings.size).toBeGreaterThanOrEqual(12);
  });
});

const db = await seededDatabase();
afterAll(() => db.close());

describe("heroPhotoProblems", () => {
  const problems = (photos: ReadonlyArray<HeroPhoto>) =>
    Effect.runPromise(
      heroPhotoProblems(photos, "https://storage.example").pipe(
        Effect.provide(Layer.merge(sqlLayer(db), clockLayer)),
      ),
    );

  const photo = (image: string, evening: string): HeroPhoto => ({
    image: `d0000000-0000-4000-8000-${image}`,
    evening,
    why: "Because",
  });

  test("is nothing for photos home can show", async () => {
    expect(
      await problems([
        photo("000000000003", "2026-08-12-react-at-acme"),
        photo("000000000004", "2026-08-12-react-at-acme"),
      ]),
    ).toEqual([]);
  });

  test("says what keeps each photo from being shown", async () => {
    await db.exec(`
      INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000201', 'https://elsewhere.example/a.jpg', '', 'Elsewhere', 800, 600, now()),
        ('d0000000-0000-4000-8000-000000000202', 'https://storage.example/photos/draft.jpg', '', 'Draft', 800, 600, now()),
        ('d0000000-0000-4000-8000-000000000203', 'https://storage.example/photos/soon.jpg', '', 'Soon', 800, 600, now());
      INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
        ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000201', now(), now()),
        ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000202', now(), now()),
        ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000203', now(), now());
    `);
    const id = (n: string) => `d0000000-0000-4000-8000-${n}`;
    expect(
      await problems([
        photo("000000000999", "2026-08-12-react-at-acme"),
        photo("000000000003", "no-such-evening"),
        photo("000000000003", "2025-12-02-café-night"),
        photo("000000000201", "2026-08-12-react-at-acme"),
        photo("000000000202", "2026-09-01-draft-night"),
        photo("000000000203", "2026-11-05-upcoming"),
      ]),
    ).toEqual([
      `${id("000000000003")} is named more than once`,
      `${id("000000000999")} (2026-08-12-react-at-acme): no such image`,
      `${id("000000000003")} (no-such-evening): no such evening`,
      `${id("000000000003")} (2025-12-02-café-night): not a photo of that evening`,
      `${id("000000000201")} (2026-08-12-react-at-acme): not on https://storage.example`,
      `${id("000000000202")} (2026-09-01-draft-night): the evening is a draft`,
      `${id("000000000203")} (2026-11-05-upcoming): the evening hasn't happened yet`,
    ]);
  });

  test("says when the evening is one we only share", async () => {
    await db.exec(`
      INSERT INTO sponsors (id, name, about, website_url, twitter_handle, updated_at) VALUES
        ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents in TypeScript.', 'https://mastra.ai', 'mastra', now());
      UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
        WHERE slug = '2026-08-12-react-at-acme';
    `);
    expect(
      await problems([photo("000000000003", "2026-08-12-react-at-acme")]),
    ).toEqual([
      "d0000000-0000-4000-8000-000000000003 (2026-08-12-react-at-acme): the evening isn't one of ours",
    ]);
  });
});
