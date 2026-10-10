import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import file from "../backfill/faces.json" with { type: "json" };
import { faceLimit } from "../src/community.ts";
import {
  type FacePick,
  FacesFile,
  faceProblems,
  facePicks,
  repeatedFaces,
} from "../src/faces.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The home lab's hand-picked faces (core/backfill/faces.json): the file
 * itself, and the check `bun run hero-photos` runs against production,
 * here against tests/seed.sql.
 */

describe("core/backfill/faces.json", () => {
  test("decodes, and names each profile once", () => {
    expect(Schema.decodeUnknownSync(FacesFile)(file).faces).toEqual(facePicks);
    expect(repeatedFaces(facePicks)).toEqual([]);
  });

  test("fills a mosaic, within what the lab reads", () => {
    expect(facePicks.length).toBeGreaterThanOrEqual(24);
    expect(facePicks.length).toBeLessThanOrEqual(faceLimit);
  });

  test("refuses an id that isn't a UUID, and an empty name", () => {
    const decode = Schema.decodeUnknownExit(FacesFile);
    const face = { profile: facePicks[0]?.profile, name: "Ada" };
    expect(decode({ faces: [face] })._tag).toBe("Success");
    expect(decode({ faces: [{ ...face, profile: "42" }] })._tag).toBe(
      "Failure",
    );
    expect(decode({ faces: [{ ...face, name: " " }] })._tag).toBe("Failure");
  });
});

const db = await seededDatabase();
afterAll(() => db.close());

describe("faceProblems", () => {
  const problems = (faces: ReadonlyArray<FacePick>) =>
    Effect.runPromise(
      faceProblems(faces, "https://storage.example").pipe(
        Effect.provide(Layer.merge(sqlLayer(db), clockLayer)),
      ),
    );
  const id = (n: string) => `b0000000-0000-4000-8000-${n}`;
  const face = (n: string, name: string): FacePick => ({
    profile: id(n),
    name,
  });

  test("is nothing for a face the lab can show", async () => {
    // Ada spoke at React at Acme, and her photo is on the origin.
    expect(await problems([face("000000000001", "Ada")])).toEqual([]);
  });

  test("says what keeps each face from being shown", async () => {
    await db.exec(`
      INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000401', 'https://elsewhere.example/linus.jpg', '', 'Linus', 400, 400, now()),
        ('d0000000-0000-4000-8000-000000000402', 'https://storage.example/people/future.jpg', '', 'Future', 400, 400, now());
      UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000401' WHERE id = '${id("000000000003")}';
      UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000402' WHERE id = '${id("000000000005")}';
    `);
    expect(
      await problems([
        face("000000000001", "Ada"),
        face("000000000001", "Ada again"),
        face("000000000999", "Nobody"),
        face("000000000002", "Grace"),
        face("000000000003", "Linus"),
        face("000000000005", "Future"),
      ]),
    ).toEqual([
      `${id("000000000001")} is named more than once`,
      `${id("000000000999")} (Nobody): no such profile`,
      `${id("000000000002")} (Grace): no photo`,
      `${id("000000000003")} (Linus): the photo isn't on https://storage.example`,
      `${id("000000000005")} (Future): hasn't been on stage at one of our evenings`,
    ]);
  });
});
