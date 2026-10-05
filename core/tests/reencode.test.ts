import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import {
  type Candidate,
  type Encoder,
  findOversized,
  imagesInputLimit,
  keyOf,
  type Media,
  maxEdge,
  reencode,
  reencodedKey,
} from "../src/reencode.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Re-encoding oversized originals, against tests/seed.sql's images on
 * https://storage.example, with a media origin and an encoder that only
 * keep count.
 */

const origin = "https://storage.example";
const megabytes = 1_000_000;

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
  await db.exec(`
    INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
      ('d0000000-0000-4000-8000-000000000101', 'https://elsewhere.example/huge.png', '', 'Elsewhere', 6000, 4000, '2026-01-01T00:00:00Z');
    UPDATE images SET updated_at = '2026-01-01T00:00:00Z';`);
});
afterEach(() => db.close());

/** Object sizes by URL, and what was stored, as the media origin would keep them. */
function fakeMedia(sizes: Record<string, number>) {
  const objects = new Map(Object.entries(sizes));
  const puts: Array<{ key: string; bytes: number; contentType: string }> = [];
  const media: Media = {
    size: async (url) => objects.get(url),
    get: async (url) => new Uint8Array(objects.get(url) ?? 0),
    put: async (key, bytes, contentType) => {
      const url = `${origin}/${key}`;
      if (objects.has(url)) return "exists";
      puts.push({ key, bytes: bytes.byteLength, contentType });
      objects.set(url, bytes.byteLength);
      return "created";
    },
  };
  return { media, objects, puts };
}

/** Makes a 4096×3072 JPEG of 3 MB, whatever it is given, and counts its edge. */
const encodeTo =
  (bytes = 3 * megabytes, format: "jpeg" | "webp" = "jpeg"): Encoder =>
  async (_, edge) => {
    expect(edge).toBe(maxEdge);
    return { bytes: new Uint8Array(bytes), format, width: 4096, height: 3072 };
  };

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const withDb = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  effect.pipe(Effect.provide(sqlLayer(db)));

const row = async (id: string) =>
  (
    await db.query<{
      url: string;
      width: number;
      height: number;
      updated: string;
    }>(
      `SELECT url, width, height, updated_at::text AS updated FROM images WHERE id = '${id}'`,
    )
  ).rows[0];

const stage = "d0000000-0000-4000-8000-000000000004";
const crowd = "d0000000-0000-4000-8000-000000000003";

describe("keys", () => {
  test("a re-encoded image goes beside its original, named after it", () => {
    expect(reencodedKey("events/e1/a.png", "jpeg")).toBe(
      "events/e1/a-reencoded.jpg",
    );
    expect(reencodedKey("events/e1/a.b.png", "webp")).toBe(
      "events/e1/a.b-reencoded.webp",
    );
    expect(reencodedKey("events/e1/a", "jpeg")).toBe(
      "events/e1/a-reencoded.jpg",
    );
  });

  test("are read from URLs on the origin alone, decoded", () => {
    expect(keyOf(`${origin}/profiles/pe%C3%B1a.png`, origin)).toBe(
      "profiles/peña.png",
    );
    expect(keyOf("https://elsewhere.example/a.png", origin)).toBeUndefined();
    expect(keyOf(`${origin}.evil/a.png`, origin)).toBeUndefined();
    expect(keyOf(`${origin}/x/../a.png`, origin)).toBeUndefined();
    expect(keyOf(`${origin}/a%E0.png`, origin)).toBeUndefined();
  });
});

describe("findOversized", () => {
  test("finds the images on the origin larger than the threshold, largest first", async () => {
    const { media } = fakeMedia({
      [`${origin}/photos/stage.jpg`]: 30 * megabytes,
      [`${origin}/photos/crowd.jpg`]: 9 * megabytes,
      [`${origin}/people/ada.jpg`]: 8 * megabytes,
      [`${origin}/covers/react.png`]: 200_000,
      "https://elsewhere.example/huge.png": 50 * megabytes,
    });
    const found = await run(
      withDb(findOversized(media, origin, 8 * megabytes)),
    );
    expect(found.map((candidate) => [candidate.key, candidate.bytes])).toEqual([
      ["photos/stage.jpg", 30 * megabytes],
      ["photos/crowd.jpg", 9 * megabytes],
    ]);
    expect(found[0]).toMatchObject({ id: stage, width: 1600, height: 900 });
  });
});

describe("reencode", () => {
  const candidate = (): Candidate => ({
    id: stage,
    url: `${origin}/photos/stage.jpg`,
    key: "photos/stage.jpg",
    width: 1600,
    height: 900,
    bytes: 30 * megabytes,
  });

  test("a dry run reports what it would do, and stores and writes nothing", async () => {
    const { media, puts } = fakeMedia({ [candidate().url]: 30 * megabytes });
    const before = await row(stage);
    const done = await run(
      withDb(
        reencode(candidate(), {
          media,
          encode: encodeTo(),
          origin,
          dryRun: true,
        }),
      ),
    );
    expect(done).toEqual({
      id: stage,
      oldKey: "photos/stage.jpg",
      newKey: "photos/stage-reencoded.jpg",
      oldBytes: 30 * megabytes,
      newBytes: 3 * megabytes,
      oldSize: "1600×900",
      newSize: "4096×3072",
      object: "dry run",
    });
    expect(puts).toEqual([]);
    expect(await row(stage)).toEqual(before);
  });

  test("stores it under a new key, keeps the original, and points the row there, so its variants change", async () => {
    const { media, objects, puts } = fakeMedia({
      [candidate().url]: 30 * megabytes,
    });
    const done = await run(
      withDb(
        reencode(candidate(), {
          media,
          encode: encodeTo(),
          origin,
          dryRun: false,
        }),
      ),
    );
    expect(done.object).toBe("stored");
    expect(puts).toEqual([
      {
        key: "photos/stage-reencoded.jpg",
        bytes: 3 * megabytes,
        contentType: "image/jpeg",
      },
    ]);
    expect(objects.get(candidate().url)).toBe(30 * megabytes);
    const after = await row(stage);
    expect(after?.url).toBe(`${origin}/photos/stage-reencoded.jpg`);
    expect(after?.width).toBe(4096);
    expect(after?.height).toBe(3072);
    expect(after?.updated).not.toStartWith("2026-01-01");
    // Run again, it is no longer a candidate.
    const again = await run(
      withDb(findOversized(media, origin, 8 * megabytes)),
    );
    expect(again).toEqual([]);
  });

  test("stores a see-through image as WebP", async () => {
    const { media, puts } = fakeMedia({ [candidate().url]: 30 * megabytes });
    await run(
      withDb(
        reencode(candidate(), {
          media,
          encode: encodeTo(2 * megabytes, "webp"),
          origin,
          dryRun: false,
        }),
      ),
    );
    expect(puts[0]?.key).toBe("photos/stage-reencoded.webp");
    expect(puts[0]?.contentType).toBe("image/webp");
  });

  test("reuses what an interrupted run stored when it is the same size", async () => {
    const { media, puts } = fakeMedia({
      [candidate().url]: 30 * megabytes,
      [`${origin}/photos/stage-reencoded.jpg`]: 3 * megabytes,
    });
    const done = await run(
      withDb(
        reencode(candidate(), {
          media,
          encode: encodeTo(),
          origin,
          dryRun: false,
        }),
      ),
    );
    expect(done.object).toBe("reused");
    expect(puts).toEqual([]);
    expect((await row(stage))?.url).toBe(
      `${origin}/photos/stage-reencoded.jpg`,
    );
  });

  const fails = async (
    sizes: Record<string, number>,
    encode: Encoder,
    reason: RegExp,
    target: Candidate = candidate(),
  ) => {
    const { media } = fakeMedia(sizes);
    const before = await row(target.id);
    const error = await run(
      Effect.flip(
        withDb(reencode(target, { media, encode, origin, dryRun: false })),
      ),
    );
    expect(error.reason).toMatch(reason);
    expect(await row(target.id)).toEqual(before);
  };

  test("never points a row at an object that isn't what it made", async () => {
    await fails(
      {
        [candidate().url]: 30 * megabytes,
        [`${origin}/photos/stage-reencoded.jpg`]: 5 * megabytes,
      },
      encodeTo(),
      /serves 5000000, not the 3000000 bytes made/,
    );
  });

  test("stores nothing still too large for the Images binding", async () => {
    await fails(
      { [candidate().url]: 30 * megabytes },
      encodeTo(imagesInputLimit + 1),
      /over the 20000000 the Images binding reads/,
    );
  });

  test("leaves a row alone that changed while it was re-encoded", async () => {
    await fails(
      { [`${origin}/photos/crowd.jpg`]: 30 * megabytes },
      encodeTo(),
      /its row changed/,
      {
        ...candidate(),
        id: crowd,
        url: `${origin}/photos/stage.jpg`,
        key: "photos/stage.jpg",
      },
    );
  });
});
