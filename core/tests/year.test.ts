import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer, Option } from "effect";
import { About } from "../src/about.ts";
import { DataSourceError } from "../src/errors.ts";
import type { HeroPick } from "../src/hero-photos.ts";
import { Year, type YearView } from "../src/year.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * A year of our evenings against the migrated production schema:
 * tests/seed.sql (React at Acme held in 2026, Café night in 2025), plus
 * New Year's Eve held at 11pm in San Francisco on December 31st 2025,
 * already 2026 in UTC, with a speaker who also spoke at React at Acme and
 * a guest count under the floor; an evening we only share, held in 2026
 * with a speaker of its own; and photos of Café night, one on another
 * origin.
 */

const shared = "e0000000-0000-4000-8000-000000000401";
const newYearsEve = "e0000000-0000-4000-8000-000000000402";

const db = await seededDatabase();
await db.exec(`
  INSERT INTO sponsors (id, name, about, updated_at) VALUES
    ('c0000000-0000-4000-8000-000000000400', 'Mastra', 'Agents in TypeScript.', now());
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, updated_at) VALUES
    ('${shared}', '2026-09-10-mastra-agents', 'Mastra agents night', 'Agents', '2026-09-11T01:00:00Z', '2026-09-11T04:00:00Z', 60, NULL, 'Mastra', NULL, 'evt-mastra', false, false, now()),
    ('${newYearsEve}', '2025-12-31-new-years-eve', 'New Year''s Eve', 'Countdown', '2026-01-01T07:00:00Z', '2026-01-01T09:00:00Z', 60, '1 Post St', 'Downtown', NULL, 'evt-nye', false, false, now());
  UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000400'
    WHERE id = '${shared}';
  UPDATE events SET luma_guest_count = 19 WHERE id = '${newYearsEve}';
  INSERT INTO talks (id, title, description, format, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000401', 'Agents in production', '', 'talk', now()),
    ('a0000000-0000-4000-8000-000000000402', 'A year of Effect', '', 'talk', now());
  INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000006', 'speaker', '2026-01-01T00:00:09Z', now()),
    ('a0000000-0000-4000-8000-000000000402', 'b0000000-0000-4000-8000-000000000003', 'speaker', '2026-01-01T00:00:10Z', now());
  INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
    ('${shared}', 'a0000000-0000-4000-8000-000000000401', '2026-01-02T00:00:09Z', now()),
    ('${newYearsEve}', 'a0000000-0000-4000-8000-000000000402', '2026-01-02T00:00:10Z', now());
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000401', 'https://storage.example/photos/cafe.jpg', '', 'Coffee at Café night', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000402', 'https://elsewhere.example/cafe.jpg', '', 'Elsewhere', 1200, 800, now());
  INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000402', '2026-01-05T00:00:01Z', now()),
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000401', '2026-01-05T00:00:02Z', now());
`);
afterAll(() => db.close());

const photoOrigin = "https://storage.example";
const acme = "2026-08-12-react-at-acme";
const cafe = "2025-12-02-café-night";

const layer = (wall: ReadonlyArray<HeroPick>, at: DateTime.Utc) =>
  Year.layerCurating(wall).pipe(
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockAt(at)),
  );

const read = (
  year: number,
  at: DateTime.Utc = now,
  wall: ReadonlyArray<HeroPick> = [],
): Promise<Option.Option<YearView>> =>
  Effect.runPromise(
    Effect.provide(
      Year.use((years) => years.read(year, photoOrigin)),
      layer(wall, at),
    ),
  );

const readSome = async (year: number, at: DateTime.Utc = now) =>
  Option.getOrThrow(await read(year, at));

const slugs = (view: YearView) =>
  view.evenings.map(({ evening }) => evening.slug);

describe("Year", () => {
  test("holds our evenings held in the year, in the order they were held, by San Francisco's calendar", async () => {
    expect(slugs(await readSome(2026))).toEqual([acme]);
    // New Year's Eve started on January 1st in UTC, December 31st here.
    expect(slugs(await readSome(2025))).toEqual([
      cafe,
      "2025-12-31-new-years-eve",
    ]);
  });

  test("counts the year's tally as the about page counts its own, at that year's evenings", async () => {
    expect((await readSome(2025)).tally).toEqual({
      evenings: 2,
      // Linus spoke at both; Grace and Ada at Café night.
      speakers: 3,
      hostingCompanies: 0,
      // Nineteen guests is under the floor: no attendance counted.
      guests: 0,
    });
    expect((await readSome(2026)).tally).toEqual({
      evenings: 1,
      speakers: 3,
      hostingCompanies: 2,
      guests: 118,
    });
  });

  test("its years' tallies add up to the about page's, but for people on stage in more than one", async () => {
    const about = await Effect.runPromise(
      Effect.provide(
        About.use((repository) => repository.read([], photoOrigin)),
        About.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockAt(now)),
        ),
      ),
    );
    const [last, first] = [await readSome(2026), await readSome(2025)];
    const sum = (key: "evenings" | "hostingCompanies" | "guests") =>
      last.tally[key] + first.tally[key];
    expect(sum("evenings")).toBe(about.evenings);
    expect(sum("hostingCompanies")).toBe(about.hostingCompanies);
    expect(sum("guests")).toBe(about.guests);
    // Grace, Ada and Linus spoke in both years; the about page counts them once.
    expect(about.speakers).toBe(3);
  });

  test("names who was on stage, each once, in the order they first came on", async () => {
    const [acmeNight] = (await readSome(2026)).evenings;
    // Effect in production (Linus), then Server components (Grace, Ada).
    expect(acmeNight?.onStage).toEqual([
      { slug: "linus", name: "Linus" },
      { slug: "grace-hopper", name: "Grace Hopper" },
      { slug: "ada-lovelace", name: "Ada Lovelace" },
    ]);
    const [cafeNight] = (await readSome(2025)).evenings;
    expect(cafeNight?.onStage.map((person) => person.slug)).toEqual([
      "linus",
      "grace-hopper",
      "ada-lovelace",
    ]);
  });

  test("reads each evening as every list does: its neighborhood and hosts, and its guests only from the floor up", async () => {
    const [acmeNight] = (await readSome(2026)).evenings;
    expect(acmeNight?.evening.hosts).toEqual(["Globex", "Acme"]);
    expect(acmeNight?.evening.status).toBe("past");
    expect(acmeNight?.guests).toBe(118);
    const [, eve] = (await readSome(2025)).evenings;
    expect(eve?.evening.neighborhood).toBe("FiDi");
    expect(eve?.guests).toBeNull();
  });

  test("shows each evening's photo as the lab picks it, from the photo origin only, or none", async () => {
    const [acmeNight] = (await readSome(2026)).evenings;
    // The first attached.
    expect(acmeNight?.photo?.url).toBe(
      "https://storage.example/photos/stage.jpg",
    );
    const [cafeNight, eve] = (await readSome(2025)).evenings;
    // Its first attached is on another origin: the next one stands for it.
    expect(cafeNight?.photo?.url).toBe(
      "https://storage.example/photos/cafe.jpg",
    );
    expect(eve?.photo).toBeNull();
    const picked = Option.getOrThrow(
      await read(2026, now, [
        { image: "d0000000-0000-4000-8000-000000000003", evening: acme },
      ]),
    );
    // The wall's pick comes first.
    expect(picked.evenings[0]?.photo?.url).toBe(
      "https://storage.example/photos/crowd.jpg",
    );
  });

  test("lists every year with an evening held, latest first", async () => {
    expect((await readSome(2026)).years).toEqual([2026, 2025]);
    const years = await Effect.runPromise(
      Effect.provide(
        Year.use((year) => year.years),
        layer([], now),
      ),
    );
    expect(years).toEqual([2026, 2025]);
  });

  test("is none for a year without an evening held: one only shared, one ahead, or none at all", async () => {
    expect(Option.isNone(await read(2024))).toBe(true);
    // At the start of 2026 here, React at Acme is still ahead.
    const january = DateTime.makeUnsafe("2026-01-02T08:00:00Z");
    expect(Option.isNone(await read(2026, january))).toBe(true);
  });

  test("never holds an evening we only share, a draft, or one not over", async () => {
    const held = slugs(await readSome(2026));
    for (const slug of [
      "2026-09-10-mastra-agents",
      "2026-09-01-draft-night",
      "2026-10-03-hack-day",
      "2026-10-03-ends-now",
      "2026-11-05-upcoming",
    ]) {
      expect(held).not.toContain(slug);
    }
  });

  test("fails as a DataSourceError when the database can't be read", async () => {
    const database = await seededDatabase();
    await database.close();
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          Year.use((year) => year.read(2026, photoOrigin)),
          Year.layerCurating([]).pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DataSourceError);
  });
});
