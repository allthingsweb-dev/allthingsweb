import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import {
  applicable,
  applyLineups,
  heldEntries,
  LineupError,
  Lineups,
  undefinedPeople,
} from "../src/lineups.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Applying researched lineups: against tests/seed.sql, and the file this
 * branch carries, which must decode and name only people it defines.
 */

const source = ["https://luma.com/example"];

const lineups: Lineups = {
  people: {
    grace: {
      profileId: "b0000000-0000-4000-8000-000000000002",
      // Grace has a title, so only the handle and photo are filled in.
      fill: {
        title: "Not written",
        twitterHandle: "grace",
        photoSourceUrl: "https://avatars.githubusercontent.com/u/2",
      },
      sources: source,
    },
    ada: { profileId: "b0000000-0000-4000-8000-000000000001", sources: source },
    kay: {
      create: {
        name: "Kay Newperson",
        title: "Engineer",
        bio: "",
        twitterHandle: "kay",
        blueskyHandle: null,
        linkedinHandle: null,
        photoSourceUrl: "https://avatars.githubusercontent.com/u/1",
      },
      sources: source,
    },
    linus: {
      create: {
        name: "Linus",
        title: "",
        bio: "",
        twitterHandle: null,
        blueskyHandle: null,
        linkedinHandle: null,
        photoSourceUrl: null,
      },
      sources: source,
    },
  },
  events: [
    {
      lumaEventId: "evt-react",
      name: "React at Acme",
      // React at Acme already links its recording.
      recordingUrl: "https://www.youtube.com/watch?v=other",
      talks: [
        {
          title: "A fireside",
          format: "fireside",
          description: "",
          speakers: [
            { person: "kay", role: "speaker" },
            { person: "ada", role: "moderator" },
          ],
          sources: source,
          confidence: "high",
        },
        {
          title: "effect in production",
          format: "talk",
          description: "Already there, by title.",
          speakers: [{ person: "linus", role: "speaker" }],
          sources: source,
          confidence: "medium",
        },
      ],
      people: [{ person: "ada", role: "mc", sources: source }],
    },
  ],
};

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const apply = (db: PGlite, input: Lineups, dryRun = false) =>
  Effect.runPromiseExit(
    applyLineups(input, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const state = async (db: PGlite) => ({
  talks: (
    await db.query(`
      SELECT t.title, t.format, string_agg(p.name || ' ' || ts.role, ', ' ORDER BY ts.created_at) AS speakers
      FROM event_talks et JOIN talks t ON t.id = et.talk_id
      LEFT JOIN talk_speakers ts ON ts.talk_id = t.id
      LEFT JOIN profiles p ON p.id = ts.speaker_id
      WHERE et.event_id = 'e0000000-0000-4000-8000-000000000001'
      GROUP BY t.id, t.title, t.format, et.created_at
      ORDER BY et.created_at, t.id`)
  ).rows,
  people: (
    await db.query(
      `SELECT p.name, ep.role, ep.position, ep.source FROM event_people ep JOIN profiles p ON p.id = ep.profile_id ORDER BY ep.role, ep.position`,
    )
  ).rows,
  profiles: (await db.query(`SELECT count(*)::int AS n FROM profiles`)).rows,
  grace: (
    await db.query(
      `SELECT title, twitter_handle, photo_source_url FROM profiles WHERE id = 'b0000000-0000-4000-8000-000000000002'`,
    )
  ).rows,
  recording: (
    await db.query(
      `SELECT recording_url FROM events WHERE id = 'e0000000-0000-4000-8000-000000000001'`,
    )
  ).rows,
});

describe("applying lineups", () => {
  test("adds talks, speakers with roles, people and new profiles", async () => {
    const db = await database();
    const exit = await apply(db, lineups);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((await state(db)).talks).toEqual([
      {
        title: "Effect in production",
        format: "talk",
        speakers: "Linus speaker",
      },
      {
        title: "Server components",
        format: "talk",
        speakers: "Grace Hopper speaker, Ada Lovelace speaker",
      },
      {
        title: "A fireside",
        format: "fireside",
        speakers: "Kay Newperson speaker, Ada Lovelace moderator",
      },
    ]);
    expect((await state(db)).grace).toEqual([
      {
        title: "Admiral",
        twitter_handle: "grace",
        photo_source_url: "https://avatars.githubusercontent.com/u/2",
      },
    ]);
    expect((await state(db)).recording).toEqual([
      { recording_url: "https://www.youtube.com/watch?v=abc123" },
    ]);
    expect((await state(db)).people).toEqual([
      { name: "Ada Lovelace", role: "mc", position: 0, source: "site" },
    ]);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lines).toEqual([
        "profile Grace Hopper: filled in",
        expect.stringMatching(/^profile Kay Newperson: created \(/),
        expect.stringMatching(
          /^profile Linus: exists \(b0000000-.*\), reused$/,
        ),
        "evt-react React at Acme",
        "  recording: already set",
        '  talk "A fireside" (fireside): kay speaker, ada moderator',
        '  talk "effect in production": already as written',
        "  mc ada: added",
      ]);
    }
  });

  test("a second run changes nothing", async () => {
    const db = await database();
    await apply(db, lineups);
    const before = await state(db);
    expect(Exit.isSuccess(await apply(db, lineups))).toBe(true);
    expect(await state(db)).toEqual(before);
  });

  test("places talks in the running order, with their starts, new and existing alike", async () => {
    const db = await database();
    const [event] = lineups.events;
    if (event === undefined) throw new Error("fixture");
    const [fireside, effect] = event.talks;
    if (fireside === undefined || effect === undefined)
      throw new Error("fixture");
    const placed: Lineups = {
      ...lineups,
      events: [
        {
          ...event,
          talks: [
            { ...fireside, position: 1, startsAt: "2026-08-12T19:10:00-07:00" },
            { ...effect, position: 0, startsAt: "2026-08-12T18:41:00-07:00" },
          ],
        },
      ],
    };
    const exit = await apply(db, placed);
    expect(Exit.isSuccess(exit)).toBe(true);
    const order = async () =>
      (
        await db.query<{
          title: string;
          position: number;
          starts_at: Date | null;
        }>(`
          SELECT t.title, et.position, et.starts_at
          FROM event_talks et JOIN talks t ON t.id = et.talk_id
          WHERE et.event_id = 'e0000000-0000-4000-8000-000000000001'
          ORDER BY et.position NULLS LAST, et.created_at, t.id`)
      ).rows.map((row) => [
        row.title,
        row.position,
        row.starts_at === null ? null : new Date(row.starts_at).toISOString(),
      ]);
    expect(await order()).toEqual([
      ["Effect in production", 0, "2026-08-13T01:41:00.000Z"],
      ["A fireside", 1, "2026-08-13T02:10:00.000Z"],
      // Server components isn't in the file: unplaced, after the placed ones.
      ["Server components", null, null],
    ]);
    // Placing an existing talk counts as a change once, then never again.
    const again = await apply(db, placed);
    expect(Exit.isSuccess(again) ? again.value.lines : []).toContain(
      '  talk "effect in production": already as written',
    );
  });

  test("a dry run does everything, then rolls back", async () => {
    const db = await database();
    const before = await state(db);
    const exit = await apply(db, lineups, true);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lines.at(-1)).toBe("Dry run: rolled back.");
      expect(exit.value.lines).toContain("  mc ada: added");
    }
    expect(await state(db)).toEqual(before);
  });

  test.each([
    [
      "an unknown event",
      {
        ...lineups,
        events: [{ ...lineups.events[0]!, lumaEventId: "evt-none" }],
      },
      "No event has the Luma id evt-none",
    ],
    [
      "an unknown profile",
      {
        ...lineups,
        people: {
          ...lineups.people,
          ada: {
            profileId: "b0000000-0000-4000-8000-0000000000ff",
            sources: source,
          },
        },
      },
      "ada: no profile b0000000-0000-4000-8000-0000000000ff",
    ],
    [
      "a person the file doesn't define",
      { ...lineups, people: { kay: lineups.people["kay"]! } },
      "People not defined in the file: ada, linus",
    ],
  ] as const)("%s writes nothing", async (_, input, reason) => {
    const db = await database();
    const before = await state(db);
    const exit = await apply(db, input);
    expect(exit).toEqual(Exit.fail(new LineupError({ reason })));
    expect(await state(db)).toEqual(before);
  });
});

describe("held entries", () => {
  const held: Lineups = {
    ...lineups,
    people: {
      ...lineups.people,
      wait: {
        create: {
          name: "Waiting Person",
          title: "",
          bio: "",
          twitterHandle: null,
          blueskyHandle: null,
          linkedinHandle: null,
          photoSourceUrl: null,
        },
        sources: source,
      },
    },
    events: [
      {
        ...lineups.events[0]!,
        talks: [
          ...lineups.events[0]!.talks,
          {
            title: "Untitled",
            format: "talk",
            description: "",
            speakers: [{ person: "wait", role: "speaker" }],
            sources: source,
            confidence: "medium",
            hold: "needs Erik: title unknown",
          },
        ],
        people: [
          ...lineups.events[0]!.people,
          {
            person: "kay",
            role: "co-host",
            sources: source,
            hold: "needs Erik: unconfirmed",
          },
        ],
      },
      {
        lumaEventId: "evt-none",
        name: "A held event",
        hold: "needs Erik: partner event",
        talks: [],
        people: [],
      },
    ],
  };

  test("are kept out of what is applied, with whom only they name", () => {
    const subset = applicable(held);
    expect(Object.keys(subset.people).toSorted()).toEqual([
      "ada",
      "grace",
      "kay",
      "linus",
    ]);
    expect(subset.events.map((e) => e.name)).toEqual(["React at Acme"]);
    expect(subset.events[0]?.talks.map((t) => t.title)).toEqual([
      "A fireside",
      "effect in production",
    ]);
    expect(subset.events[0]?.people.map((p) => p.role)).toEqual(["mc"]);
    expect(heldEntries(held)).toEqual([
      'talk "Untitled" (React at Acme): needs Erik: title unknown',
      "co-host kay (React at Acme): needs Erik: unconfirmed",
      "event A held event: needs Erik: partner event",
    ]);
  });

  test("a held person named by an entry that is not held stops the run", async () => {
    const db = await database();
    const before = await state(db);
    const exit = await apply(db, {
      ...lineups,
      people: {
        ...lineups.people,
        kay: { ...lineups.people["kay"]!, hold: "needs Erik: unconfirmed" },
      },
    });
    expect(exit).toEqual(
      Exit.fail(
        new LineupError({
          reason:
            "Held people named by entries that are not held (hold those entries too): kay",
        }),
      ),
    );
    expect(await state(db)).toEqual(before);
  });

  test.each([
    "https://:bad",
    "http://example.com/a.jpg",
    "https://localhost/a.jpg",
    "https://example.com/a b.jpg",
  ])("%s is not a URL a lineup may carry", (url) => {
    expect(() =>
      Schema.decodeUnknownSync(Lineups)({
        people: {},
        events: [
          {
            lumaEventId: "evt-x",
            name: "X",
            recordingUrl: url,
            talks: [],
            people: [],
          },
        ],
      }),
    ).toThrow();
  });

  test("are listed, and never written", async () => {
    const db = await database();
    const exit = await apply(db, held);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lines.slice(0, 3)).toEqual(
        heldEntries(held).map((h) => `held: ${h}`),
      );
    }
    const waiting = await db.query(
      `SELECT 1 FROM profiles WHERE name = 'Waiting Person'`,
    );
    expect(waiting.rows).toEqual([]);
    expect(
      (await state(db)).talks.map((t) => (t as { title: string }).title),
    ).not.toContain("Untitled");
  });
});

describe("core/backfill/lineups.json", () => {
  const file = async () =>
    Schema.decodeUnknownSync(Schema.fromJsonString(Lineups))(
      await Bun.file(
        new URL("../backfill/lineups.json", import.meta.url),
      ).text(),
    );

  test("decodes, and names only people it defines", async () => {
    expect(undefinedPeople(await file())).toEqual([]);
  });

  test("applies only the confirmed entries; the rest wait for Erik", async () => {
    const decoded = await file();
    const subset = applicable(decoded);
    expect(
      subset.events.map((event) => [
        event.name,
        event.talks.map((t) => t.title),
        event.people.map((p) => `${p.role} ${p.person}`),
      ]),
    ).toEqual([
      [
        "Effect San Francisco",
        ["Fireside chat with Michael Arnaldi, creator of Effect"],
        ["mc simon-farshid"],
      ],
      [
        "Dev Setup Demos - Show your agents.md!",
        ["My most used slash commands and custom subagents for development"],
        [],
      ],
      [
        "TypeScript AI Demo Day",
        [
          "From Framework to Platform: The Mastra Keynote at TypeScript AI Demo Day",
          "Most Agent Failures Are Context Failures",
          "Harness Engineering: How OpenAI Builds Apps Without Writing a Line of Code",
          "Claude Code Skills Are a Massive Security Threat",
          "Why Sandboxes Aren't Enough: Ivan Burazin on Building Daytona for Agents",
          "Make Your Agents Fight",
          "Why Every Business Needs a Voice Interface",
          "The Death of UI: Why Language Is the Final Interface",
          "5-Step Framework for Scaling Up Your Coding Agents",
          "RAG is Dead: Jeff Huber (Chroma) on Building Agentic Search",
          "The Three Flavors of Generative UI",
          "How to Distill an Agent's Behavior Into a Workflow",
          "Three Generations of MCP Server Design",
          "Compliance, Reliability, Observability: David Cusatis on Scaling Agents at Range",
        ],
        [],
      ],
      ["NextDev.fm Live", ["NextDev.fm Live"], []],
    ]);
    expect(Object.keys(subset.people).toSorted()).toEqual([
      "abhi-aiyer",
      "arthur-stockman",
      "dan-goosewin",
      "david-cusatis",
      "greg-pstrucha",
      "ivan-burazin",
      "jeff-huber",
      "kevin-whinnery",
      "kiet-ho",
      "mateo-torres",
      "michael-arnaldi",
      "michael-grinich",
      "mirela-prifti",
      "neel-rao",
      "nicholas-pipitone",
      "nikhil-gupta",
      "rostislav-melkumyan",
      "ryan-vogel",
      "sam-bhagwat",
      "sebastian-lorenz",
      "shane-thomas",
      "simon-farshid",
      "ted-nyman",
      "tyler-slaton",
    ]);
    expect(
      subset.events
        .flatMap((event) => event.talks)
        .every((talk) => talk.confidence === "high"),
    ).toBe(true);
    expect(heldEntries(decoded).every((h) => h.includes("needs Erik"))).toBe(
      true,
    );
  });
});
