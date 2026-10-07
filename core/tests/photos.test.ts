import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import sharp from "sharp";
import { encode, placeholder } from "../scripts/encode.ts";
import { approvalToken, isApprovalToken } from "../src/approval.ts";
import {
  addPhotos,
  contentHash,
  imageReferences,
  listPhotos,
  parseTarget,
  type PhotoFile,
  photoKey,
  planRemoval,
  removePhoto,
  replacePhoto,
} from "../src/photos.ts";
import {
  type Encoder,
  imagesInputLimit,
  type Media,
  maxEdge,
} from "../src/reencode.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Adding an evening's photos, against tests/seed.sql's React at Acme (which
 * has two photos), with a media origin that only keeps what it is given and
 * an encoder that makes a fixed JPEG.
 */

const origin = "https://media.example";
const acme = "e0000000-0000-4000-8000-000000000001";

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
  await db.exec(`UPDATE events SET short_slug = NULL`);
});
afterEach(() => db.close());

/** Objects by URL, as the media origin would serve them. */
function fakeMedia() {
  const objects = new Map<string, Uint8Array>();
  const puts: Array<{ key: string; contentType: string }> = [];
  const media: Media = {
    size: async (url) => objects.get(url)?.byteLength,
    get: async (url) => objects.get(url) ?? new Uint8Array(),
    put: async (key, bytes, contentType) => {
      const url = `${origin}/${key}`;
      if (objects.has(url)) return "exists";
      puts.push({ key, contentType });
      objects.set(url, bytes);
      return "created";
    },
  };
  return { media, objects, puts };
}

/** Encodes every file to `bytes` bytes of 4096×3072 JPEG, and checks its edge. */
const encodeTo =
  (bytes = 1000): Encoder =>
  async (input, edge) => {
    expect(edge).toBe(maxEdge);
    return {
      bytes: new Uint8Array(bytes).fill(input[0] ?? 0),
      format: "jpeg",
      width: 4096,
      height: 3072,
    };
  };

const fakePlaceholder = async () => "data:image/jpeg;base64,AA";

const file = (
  name: string,
  first: number,
  alt = `Photo ${name}`,
): PhotoFile => ({
  name,
  bytes: new Uint8Array([first, 1, 2, 3]),
  alt,
});

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const failure = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(sqlLayer(db)), Effect.flip),
  ) as Promise<{ readonly message: string }>;

const photos = async () =>
  (
    await db.query<{ url: string; alt: string; width: number }>(
      `SELECT img.url, img.alt, img.width FROM event_images ei
       JOIN images img ON img.id = ei.image_id
       WHERE ei.event_id = '${acme}' ORDER BY ei.created_at, img.id`,
    )
  ).rows;

const options = (media: Media, dryRun = false, encoder = encodeTo()) => ({
  media,
  encode: encoder,
  placeholder: fakePlaceholder,
  origin,
  dryRun,
});

describe("addPhotos", () => {
  test("stores each photo under its content's key and adds them in order, after the evening's own", async () => {
    const { media, puts } = fakeMedia();
    const before = await photos();
    const results = await run(
      addPhotos(
        "2026-08-12-react-at-acme",
        [file("b.jpg", 2, "The stage"), file("a.jpg", 1, "The food")],
        options(media),
      ),
    );
    const hashB = await contentHash(new Uint8Array([2, 1, 2, 3]));
    expect(results.map((photo) => [photo.file, photo.status])).toEqual([
      ["b.jpg", "added"],
      ["a.jpg", "added"],
    ]);
    expect(results[0]!.key).toBe(photoKey(acme, hashB, "jpeg"));
    expect(results[0]!.key).toMatch(
      /^events\/e0+-0+-4000-8000-0+1\/[0-9a-f]{64}\.jpg$/,
    );
    expect(puts.map((put) => put.contentType)).toEqual([
      "image/jpeg",
      "image/jpeg",
    ]);
    const after = await photos();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((photo) => photo.alt)).toEqual([
      "The stage",
      "The food",
    ]);
    expect(after.at(-1)!.width).toBe(4096);
  });

  test("adding the same files again changes nothing", async () => {
    const { media, puts } = fakeMedia();
    const files = [file("a.jpg", 1), file("b.jpg", 2)];
    await run(addPhotos("2026-08-12-react-at-acme", files, options(media)));
    const once = await photos();
    const again = await run(
      addPhotos("2026-08-12-react-at-acme", files, options(media)),
    );
    expect(again.map((photo) => photo.status)).toEqual([
      "already there",
      "already there",
    ]);
    expect(await photos()).toEqual(once);
    expect(puts).toHaveLength(2);
  });

  test("a later run adds only what is new, after the rest", async () => {
    const { media } = fakeMedia();
    await run(
      addPhotos("2026-08-12-react-at-acme", [file("a.jpg", 1)], options(media)),
    );
    const results = await run(
      addPhotos(
        "2026-08-12-react-at-acme",
        [file("a.jpg", 1), file("c.jpg", 3, "Last")],
        options(media),
      ),
    );
    expect(results.map((photo) => photo.status)).toEqual([
      "already there",
      "added",
    ]);
    expect((await photos()).at(-1)!.alt).toBe("Last");
  });

  test("finds the evening by its short link too", async () => {
    await db.exec(`
      INSERT INTO event_slugs (slug, event_id) VALUES ('react', '${acme}');
      UPDATE events SET short_slug = 'react' WHERE id = '${acme}';`);
    const { media } = fakeMedia();
    const results = await run(
      addPhotos("react", [file("a.jpg", 1)], options(media)),
    );
    expect(results[0]!.status).toBe("added");
  });

  test("a dry run stores nothing and writes nothing, but checks everything", async () => {
    const { media, puts } = fakeMedia();
    const before = await photos();
    const images = (await db.query(`SELECT 1 FROM images`)).rows.length;
    const results = await run(
      addPhotos(
        "2026-08-12-react-at-acme",
        [file("a.jpg", 1), file("b.jpg", 2)],
        options(media, true),
      ),
    );
    expect(results.map((photo) => photo.status)).toEqual([
      "would add",
      "would add",
    ]);
    expect(puts).toHaveLength(0);
    expect(await photos()).toEqual(before);
    expect((await db.query(`SELECT 1 FROM images`)).rows.length).toBe(images);
  });

  test("reuses an object an interrupted run stored, when it serves exactly what was made", async () => {
    const { media, objects, puts } = fakeMedia();
    const hash = await contentHash(new Uint8Array([1, 1, 2, 3]));
    // What encodeTo() makes of a.jpg: 1000 bytes of its first byte.
    objects.set(
      `${origin}/${photoKey(acme, hash, "jpeg")}`,
      new Uint8Array(1000).fill(1),
    );
    const results = await run(
      addPhotos("2026-08-12-react-at-acme", [file("a.jpg", 1)], options(media)),
    );
    expect(results[0]!.status).toBe("added");
    expect(puts).toHaveLength(0);
  });

  test.each([
    ["shorter", new Uint8Array(7), "serves 7 bytes"],
    ["as long, but other bytes", new Uint8Array(1000), "serves 1000 bytes"],
  ])(
    "refuses an object under its key that is not what was made (%s)",
    async (_, stored, message) => {
      const { media, objects } = fakeMedia();
      const hash = await contentHash(new Uint8Array([1, 1, 2, 3]));
      objects.set(`${origin}/${photoKey(acme, hash, "jpeg")}`, stored);
      const before = await photos();
      const error = await failure(
        addPhotos(
          "2026-08-12-react-at-acme",
          [file("a.jpg", 1)],
          options(media),
        ),
      );
      expect(error.message).toContain(message);
      expect(error.message).toContain("not the 1000 made from a.jpg");
      expect(await photos()).toEqual(before);
    },
  );

  test.each([
    ["no event", "nowhere", [file("a.jpg", 1)], "No event at nowhere."],
    ["no photos", "2026-08-12-react-at-acme", [], "No photos given."],
    [
      "no alt text",
      "2026-08-12-react-at-acme",
      [file("a.jpg", 1, "  ")],
      "a.jpg has no alt text.",
    ],
    [
      "the same file twice",
      "2026-08-12-react-at-acme",
      [file("a.jpg", 1), file("copy.jpg", 1)],
      "copy.jpg is the same file as a.jpg.",
    ],
  ] as const)("refuses %s", async (_, slug, files, message) => {
    const { media, puts } = fakeMedia();
    const error = await failure(addPhotos(slug, files, options(media)));
    expect(error.message).toBe(message);
    expect(puts).toHaveLength(0);
  });

  test("refuses a photo still too large for the Images binding encoded", async () => {
    const { media, puts } = fakeMedia();
    const error = await failure(
      addPhotos(
        "2026-08-12-react-at-acme",
        [file("huge.png", 1)],
        options(media, false, encodeTo(imagesInputLimit + 1)),
      ),
    );
    expect(error.message).toContain("huge.png is");
    expect(puts).toHaveLength(0);
  });
});

describe("replacePhoto", () => {
  const stage = "d0000000-0000-4000-8000-000000000004";
  const crowd = "d0000000-0000-4000-8000-000000000003";
  const slug = "2026-08-12-react-at-acme";

  const links = async () =>
    (
      await db.query<{ id: string; url: string; alt: string; at: string }>(
        `SELECT img.id, img.url, img.alt, ei.created_at::text AS at
         FROM event_images ei JOIN images img ON img.id = ei.image_id
         WHERE ei.event_id = '${acme}' ORDER BY ei.created_at, img.id`,
      )
    ).rows;
  const imageRows = async (id: string) =>
    (await db.query(`SELECT 1 FROM images WHERE id = '${id}'`)).rows.length;

  test("puts the new photo in the old one's place, and deletes only the old link and row", async () => {
    const { media, objects, puts } = fakeMedia();
    await run(addPhotos(slug, [file("a.jpg", 1, "Added")], options(media)));
    const before = await links();
    const replaced = await run(
      replacePhoto(
        slug,
        { _tag: "Position", position: 2 },
        file("new.jpg", 9, "The new crowd"),
        options(media),
      ),
    );
    expect(replaced.old).toEqual({
      imageId: crowd,
      url: "https://storage.example/photos/crowd.jpg",
      position: 2,
    });
    expect(replaced.new.status).toBe("replaced");
    const after = await links();
    expect(after.map((photo) => photo.alt)).toEqual([
      "The stage",
      "The new crowd",
      "Added",
    ]);
    expect(after[1]!.at).toBe(before[1]!.at);
    expect([after[0], after[2]]).toEqual([before[0], before[2]]);
    expect(await imageRows(crowd)).toBe(0);
    // Stored once, and nothing deleted: the media origin has no delete at all.
    expect(puts.map((put) => put.key)).toContain(replaced.new.key);
    expect(objects.size).toBe(2);
  });

  test("finds the old photo by its image id", async () => {
    const { media } = fakeMedia();
    const replaced = await run(
      replacePhoto(
        slug,
        { _tag: "ImageId", id: crowd },
        file("new.jpg", 9, "The new crowd"),
        options(media),
      ),
    );
    expect(replaced.old.position).toBe(2);
    expect((await links()).map((photo) => photo.alt)).toEqual([
      "The stage",
      "The new crowd",
    ]);
  });

  test("a dry run stores nothing and changes nothing", async () => {
    const { media, puts } = fakeMedia();
    const before = await links();
    const replaced = await run(
      replacePhoto(
        slug,
        { _tag: "Position", position: 2 },
        file("new.jpg", 9),
        options(media, true),
      ),
    );
    expect(replaced.new.status).toBe("would replace");
    expect(puts).toHaveLength(0);
    expect(await links()).toEqual(before);
    expect(await imageRows(crowd)).toBe(1);
  });

  test("refuses an old photo something else uses, and changes no row", async () => {
    // tests/seed.sql's stage photo is also a post's image.
    const { media, puts } = fakeMedia();
    const before = await links();
    const error = await failure(
      replacePhoto(
        slug,
        { _tag: "Position", position: 1 },
        file("new.jpg", 9),
        options(media),
      ),
    );
    expect(error.message).toContain("is also used by event_posts.image");
    expect(await links()).toEqual(before);
    expect(puts).toHaveLength(0);
    expect(await imageRows(stage)).toBe(1);
  });

  test.each([
    [
      "a position past the last photo",
      { _tag: "Position", position: 3 },
      file("new.jpg", 9),
      "2026-08-12-react-at-acme has 2 photos, no photo 3.",
    ],
    [
      "an image that is not the evening's",
      { _tag: "ImageId", id: "d0000000-0000-4000-8000-000000000002" },
      file("new.jpg", 9),
      "Image d0000000-0000-4000-8000-000000000002 is not one of 2026-08-12-react-at-acme's photos.",
    ],
    [
      "no alt text",
      { _tag: "Position", position: 1 },
      file("new.jpg", 9, " "),
      "new.jpg has no alt text.",
    ],
  ] as const)("refuses %s", async (_, target, photo, message) => {
    const { media, puts } = fakeMedia();
    const error = await failure(
      replacePhoto(slug, target, photo, options(media)),
    );
    expect(error.message).toBe(message);
    expect(puts).toHaveLength(0);
  });

  test("refuses a file that is already on the evening", async () => {
    const { media } = fakeMedia();
    await run(addPhotos(slug, [file("a.jpg", 1)], options(media)));
    const same = await failure(
      replacePhoto(
        slug,
        { _tag: "Position", position: 3 },
        file("a.jpg", 1),
        options(media),
      ),
    );
    expect(same.message).toBe("a.jpg is already photo 3.");
    const elsewhere = await failure(
      replacePhoto(
        slug,
        { _tag: "Position", position: 1 },
        file("a.jpg", 1),
        options(media),
      ),
    );
    expect(elsewhere.message).toBe(
      "a.jpg is already on 2026-08-12-react-at-acme, as photo 3.",
    );
  });

  test("names every column that points at an image", async () => {
    const references = (
      await db.query<{ table: string; column: string }>(
        `SELECT c.conrelid::regclass::text AS table, a.attname AS column
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f' AND c.confrelid = 'images'::regclass
         ORDER BY 1, 2`,
      )
    ).rows;
    expect(references).toEqual(
      imageReferences.map((reference) => ({ ...reference })),
    );
  });
});

describe("listPhotos", () => {
  test("lists the evening's photos in the order its page shows them", async () => {
    const listed = await run(listPhotos("2026-08-12-react-at-acme"));
    expect(listed.event).toEqual({
      id: acme,
      slug: "2026-08-12-react-at-acme",
    });
    expect(listed.photos).toEqual([
      {
        position: 1,
        imageId: "d0000000-0000-4000-8000-000000000004",
        url: "https://storage.example/photos/stage.jpg",
        alt: "The stage",
        width: 1600,
        height: 900,
      },
      {
        position: 2,
        imageId: "d0000000-0000-4000-8000-000000000003",
        url: "https://storage.example/photos/crowd.jpg",
        alt: "The crowd",
        width: 1600,
        height: 1067,
      },
    ]);
  });

  test("refuses an evening that isn't there", async () => {
    const error = await failure(listPhotos("no-such-evening"));
    expect(error.message).toBe("No event at no-such-evening.");
  });
});

describe("removePhoto", () => {
  const stage = "d0000000-0000-4000-8000-000000000004";
  const crowd = "d0000000-0000-4000-8000-000000000003";
  const slug = "2026-08-12-react-at-acme";
  const second = { _tag: "Position", position: 2 } as const;
  const first = { _tag: "Position", position: 1 } as const;

  const imageRows = async (id: string) =>
    (await db.query(`SELECT 1 FROM images WHERE id = $1`, [id])).rows.length;
  const linked = async () =>
    (
      await db.query<{ id: string }>(
        `SELECT image_id AS id FROM event_images
         WHERE event_id = $1 ORDER BY created_at, image_id`,
        [acme],
      )
    ).rows.map((row) => row.id);

  test("a dry run says exactly what would change, with its token, and changes nothing", async () => {
    const { removal, token } = await run(planRemoval(slug, second));
    expect(removal).toEqual({
      event: { id: acme, slug },
      photo: {
        position: 2,
        imageId: crowd,
        url: "https://storage.example/photos/crowd.jpg",
        alt: "The crowd",
        width: 1600,
        height: 1067,
        linkedAt: "2026-01-04T00:00:02.000Z",
      },
      imageRow: { action: "delete" },
      object: {
        url: "https://storage.example/photos/crowd.jpg",
        action: "keep",
      },
    });
    expect(token).toBe(await Effect.runPromise(approvalToken(removal)));
    expect(isApprovalToken(token)).toBe(true);
    expect(await linked()).toEqual([stage, crowd]);
    expect(await imageRows(crowd)).toBe(1);
  });

  test("removes the photo it approved: its link and its unused row, never the object", async () => {
    const { removal, token } = await run(planRemoval(slug, second));
    const removed = await run(removePhoto(slug, second, token));
    expect(removed).toEqual(removal);
    expect(await linked()).toEqual([stage]);
    expect(await imageRows(crowd)).toBe(0);
  });

  test("keeps the row of a photo something else uses, and says what", async () => {
    // tests/seed.sql's stage photo is also a post's image.
    const { removal, token } = await run(planRemoval(slug, first));
    expect(removal.imageRow).toEqual({
      action: "keep",
      usedBy: ["event_posts.image"],
    });
    await run(removePhoto(slug, first, token));
    expect(await linked()).toEqual([crowd]);
    expect(await imageRows(stage)).toBe(1);
  });

  test("finds the photo by its image id", async () => {
    const target = { _tag: "ImageId", id: crowd } as const;
    const { removal, token } = await run(planRemoval(slug, target));
    expect(removal.photo.position).toBe(2);
    await run(removePhoto(slug, target, token));
    expect(await linked()).toEqual([stage]);
  });

  test("refuses when what the position names changed since the dry run, and changes nothing", async () => {
    const { token } = await run(planRemoval(slug, first));
    // Someone else removes the stage photo: photo 1 is now the crowd.
    await db.query(
      `DELETE FROM event_images WHERE event_id = $1 AND image_id = $2`,
      [acme, stage],
    );
    const error = await failure(removePhoto(slug, first, token));
    expect(error.message).toStartWith(
      `The removal has changed since ${token} was approved: it is now `,
    );
    expect(await linked()).toEqual([crowd]);
    expect(await imageRows(crowd)).toBe(1);
  });

  test("refuses when what uses the image's row changed since the dry run", async () => {
    const { token } = await run(planRemoval(slug, second));
    // The crowd photo becomes a profile's image meanwhile: its row must stay.
    await db.query(
      `UPDATE profiles SET image = $1 WHERE id = (SELECT id FROM profiles ORDER BY id LIMIT 1)`,
      [crowd],
    );
    const error = await failure(removePhoto(slug, second, token));
    expect(error.message).toContain("has changed since");
    expect(await linked()).toEqual([stage, crowd]);
    expect(await imageRows(crowd)).toBe(1);
  });

  test("refuses a token that isn't one, or isn't this removal's", async () => {
    const malformed = await failure(removePhoto(slug, second, "yes"));
    expect(malformed.message).toBe(
      "yes is not an approval token: give the one photos remove --dry-run printed.",
    );
    const { token } = await run(planRemoval(slug, first));
    const other = await failure(removePhoto(slug, second, token));
    expect(other.message).toContain("has changed since");
    expect(await linked()).toEqual([stage, crowd]);
  });

  test.each([
    [
      "a position past the last photo",
      { _tag: "Position", position: 3 },
      "2026-08-12-react-at-acme has 2 photos, no photo 3.",
    ],
    [
      "an image that is not the evening's",
      { _tag: "ImageId", id: "d0000000-0000-4000-8000-000000000002" },
      "Image d0000000-0000-4000-8000-000000000002 is not one of 2026-08-12-react-at-acme's photos.",
    ],
  ] as const)("refuses %s", async (_, target, message) => {
    const error = await failure(planRemoval(slug, target));
    expect(error.message).toBe(message);
  });
});

describe("parseTarget", () => {
  test.each([
    ["3", { _tag: "Position", position: 3 }],
    [
      "C648C1BA-8F09-4819-9EF5-B9A1D4B4F61F",
      { _tag: "ImageId", id: "c648c1ba-8f09-4819-9ef5-b9a1d4b4f61f" },
    ],
    ["0", undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["stage", undefined],
  ] as const)("%s", (text, target) => {
    expect(parseTarget(text)).toEqual(target);
  });
});

describe("encode and placeholder", () => {
  test("a photo is stored upright, within the edge, as a JPEG without its location", async () => {
    // 60×40, with EXIF: orientation 6 (turned a quarter) and a GPS position.
    const input = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#3366cc" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 46/1 0/1" },
      })
      .toBuffer();
    const encoded = await encode(new Uint8Array(input), 30);
    expect(encoded.format).toBe("jpeg");
    expect([encoded.width, encoded.height]).toEqual([20, 30]);
    const meta = await sharp(encoded.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(await placeholder(encoded.bytes)).toMatch(
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/,
    );
  });
});
