import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import { type LibraryTalk, TalksLibrary } from "../src/talks-library.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The talks library against the migrated production schema and
 * tests/seed.sql, plus an evening we only share, over and with a talk, and
 * a talk of React at Acme held as a panel with a moderator.
 */

const shared = "e0000000-0000-4000-8000-000000000301";

const db = await seededDatabase();
await db.exec(`
  INSERT INTO sponsors (id, name, about, updated_at) VALUES
    ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents in TypeScript.', now());
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, recording_url, updated_at) VALUES
    ('${shared}', '2026-09-10-mastra-agents', 'Mastra agents night', 'Agents', '2026-09-11T01:00:00Z', '2026-09-11T04:00:00Z', 60, NULL, 'Mastra', NULL, 'evt-mastra', false, false, 'https://www.youtube.com/watch?v=mastra', now());
  UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
    WHERE id = '${shared}';
  INSERT INTO talks (id, title, description, format, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000301', 'Agents in production', '', 'talk', now()),
    ('a0000000-0000-4000-8000-000000000302', 'Where React goes next', '', 'panel', now());
  INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000006', 'speaker', '2026-01-01T00:00:09Z', now()),
    ('a0000000-0000-4000-8000-000000000302', 'b0000000-0000-4000-8000-000000000003', 'speaker', '2026-01-01T00:00:10Z', now()),
    ('a0000000-0000-4000-8000-000000000302', 'b0000000-0000-4000-8000-000000000002', 'moderator', '2026-01-01T00:00:11Z', now());
  INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
    ('${shared}', 'a0000000-0000-4000-8000-000000000301', '2026-01-02T00:00:09Z', now()),
    ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000302', '2026-01-02T00:00:10Z', now());
`);
afterAll(() => db.close());

const read = (at: DateTime.Utc = now): Promise<ReadonlyArray<LibraryTalk>> =>
  Effect.runPromise(
    Effect.provide(
      TalksLibrary.use((library) => library.read),
      TalksLibrary.layer.pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockAt(at)),
      ),
    ),
  );

/** Each talk as "title @ evening's slug". */
const listed = (talks: ReadonlyArray<LibraryTalk>) =>
  talks.map((talk) => `${talk.title} @ ${talk.evening.slug}`);

describe("TalksLibrary", () => {
  test("lists every talk given at our evenings that are over, latest evening first, each evening's talks in running order", async () => {
    expect(listed(await read())).toEqual([
      "Effect in production @ 2026-08-12-react-at-acme",
      "Server components @ 2026-08-12-react-at-acme",
      "Where React goes next @ 2026-08-12-react-at-acme",
      "Coffee & code @ 2025-12-02-café-night",
      "Server components @ 2025-12-02-café-night",
    ]);
  });

  test("lists a talk given at two evenings at each", async () => {
    const talks = await read();
    const server = talks.filter((talk) => talk.title === "Server components");
    expect(server.map((talk) => talk.id)).toEqual([
      "a0000000-0000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-000000000001",
    ]);
    expect(new Set(server.map((talk) => talk.evening.slug)).size).toBe(2);
  });

  test("names each talk's speakers as attached, linking by slug, in their capacity on stage", async () => {
    const talks = await read();
    expect(
      talks.find((talk) => talk.title === "Server components")?.speakers,
    ).toEqual([
      {
        id: "b0000000-0000-4000-8000-000000000002",
        slug: "grace-hopper",
        name: "Grace Hopper",
        role: "speaker",
      },
      {
        id: "b0000000-0000-4000-8000-000000000001",
        slug: "ada-lovelace",
        name: "Ada Lovelace",
        role: "speaker",
      },
    ]);
    const panel = talks.find((talk) => talk.title === "Where React goes next");
    expect(panel?.format).toBe("panel");
    expect(
      panel?.speakers.map((speaker) => [speaker.name, speaker.role]),
    ).toEqual([
      ["Linus", "panelist"],
      ["Grace Hopper", "moderator"],
    ]);
  });

  test("reads each talk's evening as every list does, with its recording only at an http(s) URL", async () => {
    const [first, ...rest] = await read();
    expect(first?.evening).toEqual({
      slug: "2026-08-12-react-at-acme",
      name: "React at Acme",
      topic: "react",
      status: "past",
      startsAt: DateTime.makeUnsafe("2026-08-13T01:00:00Z"),
      neighborhood: null,
      hosts: ["Globex", "Acme"],
      rsvpUrl: "https://lu.ma/event/evt-react",
      curation: { kind: "ours" },
    });
    expect(first?.recordingUrl).toBe("https://www.youtube.com/watch?v=abc123");
    // Café night's recording is javascript:, never a link.
    const cafe = rest.filter(
      (talk) => talk.evening.slug === "2025-12-02-café-night",
    );
    expect(cafe.map((talk) => talk.recordingUrl)).toEqual([null, null]);
  });

  test("never lists a talk of an evening we only share, of a draft, or of one not over", async () => {
    const titles = (await read()).map((talk) => talk.title);
    for (const title of [
      "Agents in production",
      "Secret talk",
      "Hacking live",
      "Next month",
      "Lightning talk",
    ]) {
      expect(titles).not.toContain(title);
    }
  });

  test("adds an evening's talks the minute after it ends: pages read as of the minute", async () => {
    // Ends now ends at 19:00:00; through 19:00:59.999 it is live.
    const sameMinute = await read(
      DateTime.makeUnsafe("2026-10-03T19:00:59.999Z"),
    );
    expect(listed(sameMinute)).not.toContain(
      "Lightning talk @ 2026-10-03-ends-now",
    );
    const after = await read(DateTime.makeUnsafe("2026-10-03T19:01:00.000Z"));
    expect(listed(after)[0]).toBe("Lightning talk @ 2026-10-03-ends-now");
    expect(after[0]?.evening.status).toBe("past");
  });

  test("lists nothing before any evening is over", async () => {
    expect(await read(DateTime.makeUnsafe("2024-01-01T00:00:00Z"))).toEqual([]);
  });

  test("fails as a DataSourceError when the database can't be read", async () => {
    const database = await seededDatabase();
    await database.close();
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          TalksLibrary.use((library) => library.read),
          TalksLibrary.layer.pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DataSourceError);
  });
});
