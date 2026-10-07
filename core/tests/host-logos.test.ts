import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import sharp from "sharp";
import { encode, placeholder } from "../scripts/encode.ts";
import { approvalToken } from "../src/approval.ts";
import { hostLogoKey, planHostLogos, setHostLogos } from "../src/host-logos.ts";
import { derivedId, type ImageFile } from "../src/image-columns.ts";
import { contentHash } from "../src/photos.ts";
import { type Encoder, type Media, maxEdge } from "../src/reencode.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Setting a hosting company's logos (src/host-logos.ts, on
 * src/image-columns.ts), against tests/seed.sql's Acme (a light logo, no
 * dark one) and Globex (neither), with a media origin that only keeps what
 * it is given and an encoder that makes fixed bytes from each file.
 */

const origin = "https://media.example";
const acme = "c0000000-0000-4000-8000-000000000001";
const globex = "c0000000-0000-4000-8000-000000000002";
const acmeLogo = "d0000000-0000-4000-8000-000000000002";

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
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

/** 100 bytes of the file's first byte: WebP for an even one, JPEG for an odd. */
const fakeEncode: Encoder = async (input, edge) => {
  expect(edge).toBe(maxEdge);
  const first = input[0] ?? 0;
  return {
    bytes: new Uint8Array(100).fill(first),
    format: first % 2 === 0 ? "webp" : "jpeg",
    width: 512,
    height: 512,
  };
};

const fakePlaceholder = async () => "data:image/jpeg;base64,AA";

const file = (name: string, first: number): ImageFile => ({
  name,
  bytes: new Uint8Array([first, 1, 2, 3]),
});

const tools = (media: Media) => ({
  media,
  encode: fakeEncode,
  placeholder: fakePlaceholder,
  origin,
});

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const failure = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(sqlLayer(db)), Effect.flip),
  ) as Promise<{ readonly message: string }>;

const logos = async (id: string) =>
  (
    await db.query<{ dark: string | null; light: string | null }>(
      `SELECT square_logo_dark AS dark, square_logo_light AS light
       FROM sponsors WHERE id = '${id}'`,
    )
  ).rows[0]!;

const image = async (id: string) =>
  (
    await db.query<{ url: string; alt: string; width: number }>(
      `SELECT url, alt, width FROM images WHERE id = '${id}'`,
    )
  ).rows[0];

const files = { dark: file("dark.png", 2), light: file("light.jpg", 3) };

describe("hostLogoKey", () => {
  test("keys a logo as the old admin did", () => {
    expect(
      hostLogoKey(
        "Acme Inc.",
        "dark",
        "0a1b2c3d-0000-8000-8000-000000000000",
        "webp",
      ),
    ).toBe("sponsors/acme-inc-dark-0a1b2c3d-0000-8000-8000-000000000000.webp");
    expect(hostLogoKey("Ñandú", "light", "x", "jpg")).toBe(
      "sponsors/ñandú-light-x.jpg",
    );
    expect(hostLogoKey("!!!", "light", "x", "jpg")).toBe(
      "sponsors/host-light-x.jpg",
    );
  });
});

describe("derivedId", () => {
  test("is a version 8 UUID, the same for the same seed", async () => {
    const id = await derivedId("sponsors.square_logo_dark/c/abc");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await derivedId("sponsors.square_logo_dark/c/abc")).toBe(id);
    expect(await derivedId("sponsors.square_logo_light/c/abc")).not.toBe(id);
  });
});

describe("host logos", () => {
  test("a dry run says exactly what would change, with its token, and stores and writes nothing", async () => {
    const { media, puts } = fakeMedia();
    const { change, token } = await run(
      planHostLogos("Acme", files, tools(media)),
    );
    const darkId = await derivedId(
      `sponsors.square_logo_dark/${acme}/${await contentHash(files.dark.bytes)}`,
    );
    const lightId = await derivedId(
      `sponsors.square_logo_light/${acme}/${await contentHash(files.light.bytes)}`,
    );
    expect(change.row).toEqual({ table: "sponsors", id: acme, name: "Acme" });
    expect(
      change.columns.map((column) => ({
        column: column.column,
        from: column.from,
        to: [column.to.imageId, column.to.key, column.to.url, column.to.alt],
        image: column.image,
        replaced: column.replaced,
      })),
    ).toEqual([
      {
        column: "sponsors.square_logo_dark",
        from: null,
        to: [
          darkId,
          `sponsors/acme-dark-${darkId}.webp`,
          `${origin}/sponsors/acme-dark-${darkId}.webp`,
          "Acme dark logo",
        ],
        image: "insert",
        replaced: null,
      },
      {
        column: "sponsors.square_logo_light",
        from: {
          imageId: acmeLogo,
          url: "https://storage.example/logos/acme.png",
        },
        to: [
          lightId,
          `sponsors/acme-light-${lightId}.jpg`,
          `${origin}/sponsors/acme-light-${lightId}.jpg`,
          "Acme light logo",
        ],
        image: "insert",
        replaced: {
          imageId: acmeLogo,
          url: "https://storage.example/logos/acme.png",
          row: "delete",
        },
      },
    ]);
    expect(change.columns[0]!.to).toMatchObject({
      file: "dark.png",
      format: "webp",
      width: 512,
      height: 512,
      bytes: 100,
      sha256: await contentHash(new Uint8Array(100).fill(2)),
      placeholder: "data:image/jpeg;base64,AA",
    });
    expect(token).toBe(await Effect.runPromise(approvalToken(change)));
    expect(puts).toHaveLength(0);
    expect(await logos(acme)).toEqual({ dark: null, light: acmeLogo });
  });

  test("makes the approved change: stores, records and sets both logos, and deletes the unused old row", async () => {
    const { media, objects, puts } = fakeMedia();
    const { change, token } = await run(
      planHostLogos("Acme", files, tools(media)),
    );
    const made = await run(setHostLogos("Acme", files, token, tools(media)));
    expect(made).toEqual(change);
    const [dark, light] = change.columns.map((column) => column.to);
    expect(puts).toEqual([
      { key: dark!.key, contentType: "image/webp" },
      { key: light!.key, contentType: "image/jpeg" },
    ]);
    expect(objects.get(dark!.url)).toEqual(new Uint8Array(100).fill(2));
    expect(await logos(acme)).toEqual({
      dark: dark!.imageId,
      light: light!.imageId,
    });
    expect(await image(dark!.imageId)).toEqual({
      url: dark!.url,
      alt: "Acme dark logo",
      width: 512,
    });
    expect(await image(acmeLogo)).toBeUndefined();
  });

  test("setting the same files again changes nothing and stores nothing", async () => {
    const { media, puts } = fakeMedia();
    const first = await run(planHostLogos("Acme", files, tools(media)));
    await run(setHostLogos("Acme", files, first.token, tools(media)));
    const again = await run(planHostLogos("Acme", files, tools(media)));
    expect(again.change.columns.map((column) => column.image)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    await run(setHostLogos("Acme", files, again.token, tools(media)));
    expect(puts).toHaveLength(2);
  });

  test("finds the company by its id", async () => {
    const { media } = fakeMedia();
    const { change } = await run(planHostLogos(globex, files, tools(media)));
    expect(change.row.name).toBe("Globex");
  });

  test("keeps the old logo's row while something else uses it, and says what", async () => {
    await db.exec(
      `UPDATE sponsors SET square_logo_dark = '${acmeLogo}' WHERE id = '${globex}'`,
    );
    const { media } = fakeMedia();
    const { change, token } = await run(
      planHostLogos("Acme", files, tools(media)),
    );
    expect(change.columns[1]!.replaced).toEqual({
      imageId: acmeLogo,
      url: "https://storage.example/logos/acme.png",
      row: "keep",
      usedBy: ["sponsors.square_logo_dark"],
    });
    await run(setHostLogos("Acme", files, token, tools(media)));
    expect(await image(acmeLogo)).toBeDefined();
  });

  test("deletes an old logo both columns shared once neither uses it", async () => {
    await db.exec(
      `UPDATE sponsors SET square_logo_dark = '${acmeLogo}' WHERE id = '${acme}'`,
    );
    const { media } = fakeMedia();
    const { change, token } = await run(
      planHostLogos("Acme", files, tools(media)),
    );
    expect(change.columns.map((column) => column.replaced?.row)).toEqual([
      "delete",
      "delete",
    ]);
    await run(setHostLogos("Acme", files, token, tools(media)));
    expect(await image(acmeLogo)).toBeUndefined();
  });

  test("refuses when anything changed since the dry run, before storing anything", async () => {
    const { media, puts } = fakeMedia();
    const { token } = await run(planHostLogos("Acme", files, tools(media)));
    await db.exec(
      `UPDATE sponsors SET square_logo_light = NULL WHERE id = '${acme}'`,
    );
    const error = await failure(
      setHostLogos("Acme", files, token, tools(media)),
    );
    expect(error.message).toStartWith(
      `The change has changed since ${token} was approved: it is now `,
    );
    expect(puts).toHaveLength(0);
    expect(await logos(acme)).toEqual({ dark: null, light: null });
  });

  test("refuses other files than the ones the dry run read", async () => {
    const { media, puts } = fakeMedia();
    const { token } = await run(planHostLogos("Acme", files, tools(media)));
    const error = await failure(
      setHostLogos(
        "Acme",
        { ...files, dark: file("dark.png", 4) },
        token,
        tools(media),
      ),
    );
    expect(error.message).toContain("has changed since");
    expect(puts).toHaveLength(0);
  });

  test("refuses a token that isn't one", async () => {
    const { media } = fakeMedia();
    const error = await failure(
      setHostLogos("Acme", files, "yes", tools(media)),
    );
    expect(error.message).toBe(
      "yes is not an approval token: give the one hosts logo --dry-run printed.",
    );
  });

  test("refuses an object that serves other bytes, and writes nothing", async () => {
    const { media, objects } = fakeMedia();
    const { change, token } = await run(
      planHostLogos("Acme", files, tools(media)),
    );
    objects.set(change.columns[0]!.to.url, new Uint8Array([9]));
    const error = await failure(
      setHostLogos("Acme", files, token, tools(media)),
    );
    expect(error.message).toContain("serves 1 bytes that are not the 100");
    expect(await logos(acme)).toEqual({ dark: null, light: acmeLogo });
  });

  test("names a company it can't find, and one that differs only in case", async () => {
    const { media } = fakeMedia();
    expect(
      (await failure(planHostLogos("Initech", files, tools(media)))).message,
    ).toBe("No hosting company is named Initech.");
    expect(
      (await failure(planHostLogos("acme", files, tools(media)))).message,
    ).toBe("No hosting company is named acme; did you mean Acme?");
  });

  test("encodes a see-through logo as WebP and an opaque one as JPEG", async () => {
    const see = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const solid = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const { change } = await run(
      planHostLogos(
        "Globex",
        {
          dark: { name: "dark.png", bytes: new Uint8Array(see) },
          light: { name: "light.png", bytes: new Uint8Array(solid) },
        },
        { encode, placeholder, origin },
      ),
    );
    expect(change.columns.map((column) => column.to.format)).toEqual([
      "webp",
      "jpeg",
    ]);
    expect(change.columns[0]!.to.key).toEndWith(".webp");
    expect(change.columns[1]!.to.key).toEndWith(".jpg");
  });
});
