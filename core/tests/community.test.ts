import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { About } from "../src/about.ts";
import { Community, type CommunityView } from "../src/community.ts";
import type { FacePick } from "../src/faces.ts";
import type { HeroPick } from "../src/hero-photos.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The home lab's read against the migrated production schema:
 * tests/seed.sql, plus photos of Café night, a draft's and an upcoming
 * evening's, one on another origin, and portraits for people who have been
 * on stage, will be, or only were at a draft.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000301', 'https://storage.example/photos/cafe.jpg', '', 'Coffee at Café night', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000302', 'https://elsewhere.example/cafe.jpg', '', 'Elsewhere', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000303', 'https://storage.example/photos/draft.jpg', '', 'A draft', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000304', 'https://storage.example/photos/soon.jpg', '', 'Not yet', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000305', 'https://storage.example/people/linus.jpg', '', 'Linus', 400, 400, now()),
    ('d0000000-0000-4000-8000-000000000306', 'https://storage.example/people/draft-only.jpg', '', 'Draft Only', 400, 400, now()),
    ('d0000000-0000-4000-8000-000000000307', 'https://storage.example/people/future.jpg', '', 'Future Speaker', 400, 400, now()),
    ('d0000000-0000-4000-8000-000000000308', 'https://elsewhere.example/zed.jpg', '', 'Zed', 400, 400, now());
  INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000301', '2026-01-05T00:00:01Z', now()),
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000302', '2026-01-05T00:00:02Z', now()),
    ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000303', '2026-01-05T00:00:03Z', now()),
    ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000304', '2026-01-05T00:00:04Z', now());
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000305' WHERE id = 'b0000000-0000-4000-8000-000000000003';
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000306' WHERE id = 'b0000000-0000-4000-8000-000000000004';
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000307' WHERE id = 'b0000000-0000-4000-8000-000000000005';
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000308' WHERE id = 'b0000000-0000-4000-8000-000000000006';
  INSERT INTO event_slugs (slug, event_id) VALUES ('cafe', 'e0000000-0000-4000-8000-000000000006');
  UPDATE events SET short_slug = 'cafe' WHERE id = 'e0000000-0000-4000-8000-000000000006';
`);
afterAll(() => db.close());

const photoOrigin = "https://storage.example";
const image = (n: string) => `d0000000-0000-4000-8000-${n}`;
const profile = (n: string) => `b0000000-0000-4000-8000-${n}`;
const acme = "2026-08-12-react-at-acme";
const cafe = "2025-12-02-café-night";

const read = (
  wall: ReadonlyArray<HeroPick> = [],
  faces: ReadonlyArray<Pick<FacePick, "profile">> = [],
): Promise<CommunityView> =>
  Effect.runPromise(
    Effect.provide(
      Community.use((community) => community.read(photoOrigin)),
      Community.layerCurating(wall, faces).pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockAt(now)),
      ),
    ),
  );

const urls = (view: CommunityView) =>
  view.wall.map((photo) => photo.photo.url.replace(`${photoOrigin}/`, ""));

describe("Community", () => {
  test("counts what the about page counts", async () => {
    const about = await Effect.runPromise(
      Effect.provide(
        About.use((repository) => repository.read([], photoOrigin)),
        About.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockAt(now)),
        ),
      ),
    );
    const { tally } = await read();
    expect(tally).toEqual({
      evenings: about.evenings,
      speakers: about.speakers,
      hostingCompanies: about.hostingCompanies,
      guests: about.guests,
    });
    expect(tally.evenings).toBeGreaterThan(0);
  });

  test("without picks, walls every photo of our evenings held, latest first, as attached", async () => {
    const view = await read();
    expect(urls(view)).toEqual([
      "photos/stage.jpg",
      "photos/crowd.jpg",
      "photos/cafe.jpg",
    ]);
    expect(view.wall[0]?.slug).toBe(acme);
    expect(view.wall[0]?.startsAt).toEqual(
      DateTime.makeUnsafe("2026-08-13T01:00:00Z"),
    );
    // Café night is linked by its short link.
    expect(view.wall[2]?.slug).toBe("cafe");
    expect(view.wall[2]?.photo).toEqual({
      url: `${photoOrigin}/photos/cafe.jpg`,
      alt: "Coffee at Café night",
      width: 1200,
      height: 800,
      version: expect.stringMatching(/^[0-9]+$/),
    });
  });

  test("walls the picks it can show, in their order, each as its evening's", async () => {
    const view = await read([
      { image: image("000000000301"), evening: cafe },
      // Another origin, a draft's, an evening ahead's, and one named as
      // another evening's: none is shown.
      { image: image("000000000302"), evening: cafe },
      { image: image("000000000303"), evening: "2026-09-01-draft-night" },
      { image: image("000000000304"), evening: "2026-11-05-upcoming" },
      { image: image("000000000003"), evening: cafe },
      // No such image.
      { image: image("000000000999"), evening: acme },
      { image: image("000000000003"), evening: acme },
    ]);
    expect(urls(view)).toEqual(["photos/cafe.jpg", "photos/crowd.jpg"]);
    expect(view.wall.map((photo) => photo.slug)).toEqual(["cafe", acme]);
  });

  test("falls back to every photo when it can show none of the picks", async () => {
    const view = await read([
      { image: image("000000000303"), evening: "2026-09-01-draft-night" },
    ]);
    expect(urls(view)).toEqual([
      "photos/stage.jpg",
      "photos/crowd.jpg",
      "photos/cafe.jpg",
    ]);
  });

  test("without picks, shows everyone on stage at our evenings held with a photo here, latest first", async () => {
    const { faces } = await read();
    // Ada spoke at React at Acme, Linus there and at Café night. Not Grace
    // (no photo), Zed (on another origin), Draft Only (a draft's) or Future
    // Speaker (not yet).
    expect(faces.map((face) => face.name).toSorted()).toEqual([
      "Ada Lovelace",
      "Linus",
    ]);
    const [first] = faces;
    expect(first?.photo.url).toMatch(/^https:\/\/storage\.example\/people\//);
    expect(first?.slug).toMatch(/^[a-z0-9-]+$/);
  });

  test("shows the picked faces it can, in their order", async () => {
    const { faces } = await read(
      [],
      [
        { profile: profile("000000000003") },
        { profile: profile("000000000002") },
        { profile: profile("000000000004") },
        { profile: profile("000000000005") },
        { profile: profile("000000000006") },
        { profile: profile("000000000001") },
      ],
    );
    expect(faces.map((face) => face.name)).toEqual(["Linus", "Ada Lovelace"]);
  });
});
