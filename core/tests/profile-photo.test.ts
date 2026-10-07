import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../src/approval.ts";
import { derivedId, type ImageFile } from "../src/image-columns.ts";
import { contentHash } from "../src/photos.ts";
import { planProfilePhoto, setProfilePhoto } from "../src/profile-photo.ts";
import { type Encoder, type Media, maxEdge } from "../src/reencode.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Setting a profile's photo (src/profile-photo.ts, on src/image-columns.ts),
 * against tests/seed.sql's Ada Lovelace (whose photo is also a post's
 * author avatar) and Grace Hopper (no photo), with a media origin that only
 * keeps what it is given and an encoder that makes fixed bytes.
 */

const origin = "https://media.example";
const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const adaPhoto = "d0000000-0000-4000-8000-000000000005";

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

/** 100 bytes of the file's first byte, as a 400×400 JPEG. */
const fakeEncode: Encoder = async (input, edge) => {
  expect(edge).toBe(maxEdge);
  return {
    bytes: new Uint8Array(100).fill(input[0] ?? 0),
    format: "jpeg",
    width: 400,
    height: 400,
  };
};

const tools = (media: Media) => ({
  media,
  encode: fakeEncode,
  placeholder: async () => "data:image/jpeg;base64,AA",
  origin,
});

const photo: ImageFile = { name: "ada.jpg", bytes: new Uint8Array([7, 1]) };

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const failure = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(sqlLayer(db)), Effect.flip),
  ) as Promise<{ readonly message: string }>;

const imageOf = async (id: string) =>
  (
    await db.query<{ image: string | null }>(
      `SELECT image FROM profiles WHERE id = $1`,
      [id],
    )
  ).rows[0]!.image;

const imageRow = async (id: string) =>
  (
    await db.query<{ url: string; alt: string }>(
      `SELECT url, alt FROM images WHERE id = $1`,
      [id],
    )
  ).rows[0];

describe("profile photos", () => {
  test("a dry run says exactly what would change, with its token, and stores and writes nothing", async () => {
    const { media, puts } = fakeMedia();
    const { change, token } = await run(
      planProfilePhoto("ada-lovelace", photo, tools(media)),
    );
    const id = await derivedId(
      `profiles.image/${ada}/${await contentHash(photo.bytes)}`,
    );
    expect(change.row).toEqual({
      table: "profiles",
      id: ada,
      name: "Ada Lovelace",
    });
    expect(change.columns).toHaveLength(1);
    expect(change.columns[0]).toMatchObject({
      column: "profiles.image",
      from: {
        imageId: adaPhoto,
        url: "https://storage.example/people/ada.jpg",
      },
      to: {
        imageId: id,
        key: `profiles/ada-lovelace-${id}.jpg`,
        url: `${origin}/profiles/ada-lovelace-${id}.jpg`,
        alt: "Ada Lovelace",
        width: 400,
        height: 400,
      },
      image: "insert",
      // The seed's post by Ada carries her photo as its author's avatar.
      replaced: {
        imageId: adaPhoto,
        url: "https://storage.example/people/ada.jpg",
        row: "keep",
        usedBy: ["event_posts.author_avatar"],
      },
    });
    expect(token).toBe(await Effect.runPromise(approvalToken(change)));
    expect(puts).toHaveLength(0);
    expect(await imageOf(ada)).toBe(adaPhoto);
  });

  test("makes the approved change, keeping the old row something else uses", async () => {
    const { media, puts } = fakeMedia();
    const { change, token } = await run(
      planProfilePhoto("ada-lovelace", photo, tools(media)),
    );
    expect(
      await run(setProfilePhoto("ada-lovelace", photo, token, tools(media))),
    ).toEqual(change);
    const { to } = change.columns[0]!;
    expect(puts).toEqual([{ key: to.key, contentType: "image/jpeg" }]);
    expect(await imageOf(ada)).toBe(to.imageId);
    expect(await imageRow(to.imageId)).toEqual({
      url: to.url,
      alt: "Ada Lovelace",
    });
    expect(await imageRow(adaPhoto)).toBeDefined();
  });

  test("deletes the old photo's row when nothing else uses it", async () => {
    await db.query(
      `INSERT INTO images (id, url, placeholder, alt, width, height, updated_at)
       VALUES ('d0000000-0000-4000-8000-000000000099', 'https://storage.example/people/grace.jpg', '', 'Grace Hopper', 10, 10, now())`,
    );
    await db.query(
      `UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000099' WHERE id = $1`,
      [grace],
    );
    const { media } = fakeMedia();
    const { change, token } = await run(
      planProfilePhoto("Grace Hopper", photo, tools(media)),
    );
    expect(change.columns[0]!.replaced).toEqual({
      imageId: "d0000000-0000-4000-8000-000000000099",
      url: "https://storage.example/people/grace.jpg",
      row: "delete",
    });
    await run(setProfilePhoto("Grace Hopper", photo, token, tools(media)));
    expect(
      await imageRow("d0000000-0000-4000-8000-000000000099"),
    ).toBeUndefined();
  });

  test("finds the profile by its slug, its id or its exact name", async () => {
    const { media } = fakeMedia();
    for (const name of ["grace-hopper", grace, "Grace Hopper"]) {
      const { change } = await run(planProfilePhoto(name, photo, tools(media)));
      expect(change.row.id).toBe(grace);
      expect(change.columns[0]!.from).toBeNull();
    }
  });

  test("refuses a name two profiles share, and one no profile has", async () => {
    await db.query(
      `INSERT INTO profiles (name, title, bio, profile_type, updated_at)
       VALUES ('Grace Hopper', '', '', 'member', now())`,
    );
    const { media } = fakeMedia();
    const shared = await failure(
      planProfilePhoto("Grace Hopper", photo, tools(media)),
    );
    expect(shared.message).toStartWith(
      "2 profiles are named Grace Hopper: give one's slug (grace-hopper, ",
    );
    const nobody = await failure(
      planProfilePhoto("Nobody", photo, tools(media)),
    );
    expect(nobody.message).toBe(
      "No profile is Nobody: give its id, its slug or its exact name.",
    );
  });

  test("refuses when anything changed since the dry run, before storing anything", async () => {
    const { media, puts } = fakeMedia();
    const { token } = await run(
      planProfilePhoto("grace-hopper", photo, tools(media)),
    );
    await db.query(`UPDATE profiles SET image = $1 WHERE id = $2`, [
      adaPhoto,
      grace,
    ]);
    const error = await failure(
      setProfilePhoto("grace-hopper", photo, token, tools(media)),
    );
    expect(error.message).toStartWith(
      `The change has changed since ${token} was approved: it is now `,
    );
    expect(error.message).toContain(
      "Read it again with people photo --dry-run",
    );
    expect(puts).toHaveLength(0);
    expect(await imageOf(grace)).toBe(adaPhoto);
  });

  test("refuses when the person was renamed since the dry run", async () => {
    const { media, puts } = fakeMedia();
    const { token } = await run(planProfilePhoto(grace, photo, tools(media)));
    await db.query(
      `UPDATE profiles SET name = 'Grace B. Hopper' WHERE id = $1`,
      [grace],
    );
    const error = await failure(
      setProfilePhoto(grace, photo, token, tools(media)),
    );
    expect(error.message).toContain("has changed since");
    expect(puts).toHaveLength(0);
  });
});
