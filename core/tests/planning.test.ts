import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import { isTopic } from "../src/lockup.ts";
import { formatIdea } from "../src/planning/format.ts";
import { isAvailableOn } from "../src/planning/model.ts";
import {
  containsPattern,
  Planning,
  windowProblem,
} from "../src/planning/planning.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The planning service (src/planning/) on tests/seed.sql. Every row here is
 * made up in this file: nothing in the repository holds planning rows
 * (tests/planning-privacy.test.ts).
 */

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const ada = "b0000000-0000-4000-8000-000000000001";
const acme = "c0000000-0000-4000-8000-000000000001";
const globex = "c0000000-0000-4000-8000-000000000002";
const pastEvening = "2026-08-12-react-at-acme";
const draftEvening = "2026-09-01-draft-night";

const layer = () =>
  Planning.layer.pipe(
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );

const plan = <A, E>(
  f: (planning: Planning["Service"]) => Effect.Effect<A, E>,
) => Effect.runPromise(Planning.use(f).pipe(Effect.provide(layer())));

/** The message a call fails with. */
const refusal = async <A, E>(
  f: (planning: Planning["Service"]) => Effect.Effect<A, E>,
): Promise<string> => {
  const exit = await Effect.runPromiseExit(
    Planning.use(f).pipe(Effect.provide(layer())),
  );
  if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const count = async (table: string) =>
  (
    await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM planning.${table}`,
    )
  ).rows[0]?.count;

describe("ideas", () => {
  test("adds one, linked to the evening it builds on", async () => {
    const idea = await plan((p) =>
      p.addIdea({
        title: "Made-up quiz night",
        pitch: "Teams, rounds, prizes.",
        program: "social",
        topic: "quiz",
        inspiredBySlug: pastEvening,
      }),
    );
    expect(idea).toMatchObject({
      title: "Made-up quiz night",
      program: "social",
      topic: "quiz",
      status: "idea",
      event: null,
      inspiredBy: { slug: pastEvening, name: "React at Acme", isDraft: false },
    });
    expect(await plan((p) => p.listIdeas())).toEqual([idea]);
  });

  test("becomes a draft evening, then scheduled", async () => {
    const { id } = await plan((p) =>
      p.addIdea({ title: "An idea", pitch: "A pitch.", program: "talks" }),
    );
    expect(
      await refusal((p) => p.updateIdea(id, { status: "scheduled" })),
    ).toBe("A scheduled idea names its event (eventSlug).");
    const drafting = await plan((p) =>
      p.updateIdea(id, { status: "drafting", eventSlug: draftEvening }),
    );
    expect(drafting).toMatchObject({
      status: "drafting",
      event: { slug: draftEvening, isDraft: true },
    });
    const scheduled = await plan((p) =>
      p.updateIdea(id, { status: "scheduled", topic: "drafts" }),
    );
    expect(scheduled).toMatchObject({ status: "scheduled", topic: "drafts" });
    expect(
      await plan((p) => p.listIdeas({ status: "scheduled" })),
    ).toHaveLength(1);
    expect(await plan((p) => p.listIdeas({ status: "idea" }))).toEqual([]);
    const cleared = await plan((p) => p.updateIdea(id, { topic: null }));
    expect(cleared.topic).toBeNull();
  });

  test("one idea per event", async () => {
    await plan((p) =>
      p.addIdea({
        title: "First",
        pitch: "One.",
        program: "talks",
        eventSlug: draftEvening,
      }),
    );
    expect(
      await refusal((p) =>
        p.addIdea({
          title: "Second",
          pitch: "Two.",
          program: "talks",
          eventSlug: draftEvening,
        }),
      ),
    ).toMatch(/^That event is already idea [0-9a-f-]+'s\.$/);
  });

  test("refuses what isn't there, writing nothing", async () => {
    expect(
      await refusal((p) =>
        p.addIdea({
          title: "Nowhere",
          pitch: "None.",
          program: "talks",
          eventSlug: "no-such-evening",
        }),
      ),
    ).toBe('No event, published or draft, has the slug "no-such-evening".');
    expect(
      await refusal((p) =>
        p.updateIdea("00000000-0000-4000-8000-000000000000", { title: "X" }),
      ),
    ).toBe("No idea has the id 00000000-0000-4000-8000-000000000000.");
    expect(await refusal((p) => p.updateIdea("nope", { title: "X" }))).toBe(
      "No idea has the id nope.",
    );
    expect(await count("ideas")).toBe(0);
  });

  test("the database holds topics to isTopic, as it holds events'", async () => {
    const rule = async (table: string, constraint: string) =>
      (
        await db.query<{ def: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname || '.' || t.relname = $1 AND c.conname = $2`,
          [table, constraint],
        )
      ).rows[0]?.def;
    const events = await rule("public.events", "events_topic_check");
    expect(events).toBeDefined();
    expect(await rule("planning.ideas", "ideas_topic_check")).toBe(events);
    expect(
      await rule(
        "planning.wanted_speaker_topics",
        "wanted_speaker_topics_topic_check",
      ),
    ).toBe(events);
  });
});

describe("wanted speakers", () => {
  test("a profile, by name in any case, with topics and availability", async () => {
    const speaker = await plan((p) =>
      p.addWantedSpeaker(
        { _tag: "Profile", ref: "ada lovelace" },
        {
          topics: ["compilers", "effect", "compilers"],
          note: "Asked at the last evening.",
          availability: [
            { startsOn: "2027-01-01", note: "free after Dec" },
            {
              kind: "unavailable",
              startsOn: "2027-02-10",
              endsOn: "2027-02-20",
            },
          ],
        },
      ),
    );
    expect(speaker).toMatchObject({
      person: { kind: "profile", profileId: ada, name: "Ada Lovelace" },
      status: "wanted",
      topics: ["compilers", "effect"],
      note: "Asked at the last evening.",
      availability: [
        {
          kind: "available",
          startsOn: "2027-01-01",
          endsOn: null,
          note: "free after Dec",
        },
        {
          kind: "unavailable",
          startsOn: "2027-02-10",
          endsOn: "2027-02-20",
          note: null,
        },
      ],
      notes: [],
    });
    const on = (day: string) =>
      plan((p) => p.listWantedSpeakers({ availableOn: day })).then((rows) =>
        rows.map((row) => row.id),
      );
    expect(await on("2026-12-15")).toEqual([]);
    expect(await on("2027-01-15")).toEqual([speaker.id]);
    expect(await on("2027-02-15")).toEqual([]);
    expect(
      await plan((p) => p.listWantedSpeakers({ topic: "effect" })),
    ).toHaveLength(1);
    expect(await plan((p) => p.listWantedSpeakers({ topic: "react" }))).toEqual(
      [],
    );
  });

  test("someone new becomes a contact, at a company we know", async () => {
    const speaker = await plan((p) =>
      p.addWantedSpeaker(
        {
          _tag: "NewContact",
          contact: {
            name: "Made-up Person",
            email: "made-up@example.com",
            company: "Acme",
          },
        },
        { topics: ["ai"] },
      ),
    );
    expect(speaker.person).toMatchObject({
      kind: "contact",
      contact: {
        name: "Made-up Person",
        email: "made-up@example.com",
        url: null,
        company: "Acme",
      },
    });
    expect(await count("contacts")).toBe(1);
  });

  test("once per person; changes go through update", async () => {
    const { id } = await plan((p) =>
      p.addWantedSpeaker({ _tag: "Profile", ref: ada }, { topics: ["ai"] }),
    );
    expect(
      await refusal((p) =>
        p.addWantedSpeaker({ _tag: "Profile", ref: ada }, { topics: ["ai"] }),
      ),
    ).toBe(`Already wanted, as ${id}; change them with speaker update.`);
    const asked = await plan((p) =>
      p.updateWantedSpeaker(id, {
        status: "asked",
        addTopics: ["git"],
        removeTopics: ["ai"],
        addAvailability: [{ endsOn: "2026-11-30", note: "until Thanksgiving" }],
      }),
    );
    expect(asked).toMatchObject({ status: "asked", topics: ["git"] });
    const [window] = asked.availability;
    expect(window).toMatchObject({ endsOn: "2026-11-30" });
    const removed = await plan((p) =>
      p.updateWantedSpeaker(id, { removeAvailability: [window?.id ?? ""] }),
    );
    expect(removed.availability).toEqual([]);
    expect(
      await refusal((p) =>
        p.updateWantedSpeaker(id, { removeTopics: ["git"] }),
      ),
    ).toBe(
      "A wanted speaker keeps at least one topic: add one before removing the last.",
    );
    expect(await refusal((p) => p.updateWantedSpeaker(id, {}))).toBe(
      "Nothing to change.",
    );
    expect(
      await refusal((p) =>
        p.updateWantedSpeaker(id, {
          removeTopics: ["react"],
          addTopics: ["ai"],
        }),
      ),
    ).toBe("Not this speaker's topics: react.");
    expect((await plan((p) => p.listWantedSpeakers()))[0]?.topics).toEqual([
      "git",
    ]);
  });

  test("refuses windows that say nothing or run backwards", async () => {
    expect(
      await refusal((p) =>
        p.addWantedSpeaker(
          { _tag: "Profile", ref: ada },
          { topics: ["ai"], availability: [{ kind: "unavailable" }] },
        ),
      ),
    ).toBe("An availability window needs a start, an end or a note.");
    expect(
      await refusal((p) =>
        p.addWantedSpeaker(
          { _tag: "Profile", ref: ada },
          {
            topics: ["ai"],
            availability: [{ startsOn: "2027-02-01", endsOn: "2027-01-01" }],
          },
        ),
      ),
    ).toBe(
      "An availability window can't end (2027-01-01) before it starts (2027-02-01).",
    );
    expect(await count("wanted_speakers")).toBe(0);
  });

  test("a name two profiles share is refused with both ids", async () => {
    await db.exec(
      `INSERT INTO profiles (id, name, title, bio, profile_type, updated_at) VALUES
        ('b0000000-0000-4000-8000-0000000000aa', 'Ada Lovelace', '', '', 'member', now())`,
    );
    expect(
      await refusal((p) =>
        p.addWantedSpeaker(
          { _tag: "Profile", ref: "Ada Lovelace" },
          { topics: ["ai"] },
        ),
      ),
    ).toBe(
      `2 profiles are named "Ada Lovelace": ${ada}, b0000000-0000-4000-8000-0000000000aa. Name one by its id.`,
    );
  });
});

describe("host prospects", () => {
  test("a company we know, with when it last hosted", async () => {
    const prospect = await plan((p) =>
      p.addHostProspect(
        { _tag: "Host", ref: "globex" },
        { _tag: "NewContact", contact: { name: "Made-up Contact" } },
        { note: "Big space." },
      ),
    );
    expect(prospect).toMatchObject({
      company: { kind: "host", sponsorId: globex, name: "Globex" },
      contact: { name: "Made-up Contact" },
      status: "prospect",
      note: "Big space.",
      lastHosted: { slug: pastEvening },
      timesHosted: 1,
    });
    const asked = await plan((p) =>
      p.updateHostProspect(prospect.id, { status: "asked", note: null }),
    );
    expect(asked).toMatchObject({ status: "asked", note: null });
  });

  test("a new company, never a second time, and not one we know by another route", async () => {
    const prospect = await plan((p) =>
      p.addHostProspect(
        { _tag: "NewCompany", name: "Made-up Co" },
        undefined,
        {},
      ),
    );
    expect(prospect).toMatchObject({
      company: { kind: "new", name: "Made-up Co" },
      lastHosted: null,
      timesHosted: 0,
    });
    expect(
      await refusal((p) =>
        p.addHostProspect(
          { _tag: "NewCompany", name: "made-up co" },
          undefined,
          {},
        ),
      ),
    ).toBe(
      `Already a prospect, as ${prospect.id}; change it with host update.`,
    );
    expect(
      await refusal((p) =>
        p.addHostProspect({ _tag: "NewCompany", name: "ACME" }, undefined, {}),
      ),
    ).toBe(
      `Acme is a hosting company we know (${acme}): name it with sponsor.`,
    );
    // The database holds the name unique in any case, whoever writes it.
    await expect(
      db.exec(
        `INSERT INTO planning.host_prospects (company_name) VALUES ('MADE-UP CO')`,
      ),
    ).rejects.toThrow("host_prospects_company_name_unique");
  });
});

describe("notes and search", () => {
  test("notes show on the person and the company, and search finds everything", async () => {
    const speaker = await plan((p) =>
      p.addWantedSpeaker(
        { _tag: "Profile", ref: ada },
        { topics: ["compilers"], availability: [{ note: "free after Dec" }] },
      ),
    );
    await plan((p) =>
      p.addNote(
        { _tag: "Profile", ref: ada },
        "Met at the made-up meetup.",
        "Erik",
      ),
    );
    await plan((p) =>
      p.addHostProspect({ _tag: "Host", ref: acme }, undefined, {}),
    );
    await plan((p) =>
      p.addNote({ _tag: "Host", ref: "Acme" }, "Prefers Tuesdays."),
    );
    await plan((p) =>
      p.addIdea({
        title: "Compilers evening",
        pitch: "Free after Dec, maybe.",
        program: "talks",
      }),
    );
    const [listed] = await plan((p) => p.listWantedSpeakers());
    expect(listed?.id).toBe(speaker.id);
    expect(listed?.notes).toMatchObject([
      { body: "Met at the made-up meetup.", author: "Erik" },
    ]);
    const [host] = await plan((p) => p.listHostProspects());
    expect(host?.notes).toMatchObject([
      { body: "Prefers Tuesdays.", author: null },
    ]);
    const hits = await plan((p) => p.search("FREE AFTER DEC"));
    expect(hits.map((hit) => [hit.kind, hit.label])).toEqual([
      ["idea", "Compilers evening"],
      ["wanted speaker", "Ada Lovelace"],
    ]);
    expect(
      (await plan((p) => p.search("tuesday"))).map((hit) => hit.kind),
    ).toEqual(["note"]);
    expect(await plan((p) => p.search("100%"))).toEqual([]);
    expect(await refusal((p) => p.search("  "))).toBe("Search for something.");
    expect(
      await refusal((p) => p.addNote({ _tag: "Profile", ref: ada }, " ")),
    ).toBe("A note says something.");
  });
});

describe("pure rules", () => {
  test("isAvailableOn", () => {
    const free = {
      kind: "available" as const,
      startsOn: "2027-01-01",
      endsOn: null,
    };
    const away = {
      kind: "unavailable" as const,
      startsOn: "2027-03-01",
      endsOn: "2027-03-31",
    };
    const noted = { kind: "available" as const, startsOn: null, endsOn: null };
    expect(isAvailableOn([], "2026-01-01")).toBe(true);
    expect(isAvailableOn([noted], "2026-01-01")).toBe(true);
    expect(isAvailableOn([free], "2026-12-31")).toBe(false);
    expect(isAvailableOn([free], "2027-01-01")).toBe(true);
    expect(isAvailableOn([free, away], "2027-03-15")).toBe(false);
    expect(isAvailableOn([away], "2027-04-01")).toBe(true);
  });

  test("windowProblem and containsPattern", () => {
    expect(windowProblem({ note: "ask in spring" })).toBeUndefined();
    expect(windowProblem({})).toBeDefined();
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  test("topics follow isTopic", () => {
    expect(isTopic("alpha-nerd trivia")).toBe(true);
  });
});

describe("as text", () => {
  test("an evening reads on its day in San Francisco", () => {
    expect(
      formatIdea({
        id: "f0000000-0000-4000-8000-000000000001",
        title: "Made-up quiz",
        pitch: "Rounds.",
        program: "social",
        topic: "quiz",
        status: "idea",
        event: null,
        inspiredBy: {
          slug: "2025-10-07-made-up",
          name: "Made up",
          startDate: "2025-10-08T00:00:00.000Z",
          isDraft: false,
        },
        createdAt: "2026-10-05T23:00:00.000Z",
        updatedAt: "2026-10-05T23:00:00.000Z",
      }),
    ).toBe(
      [
        "Made-up quiz [idea] f0000000-0000-4000-8000-000000000001",
        "  social · all things/quiz",
        "  Rounds.",
        "  builds on: 2025-10-07-made-up (2025-10-07)",
      ].join("\n"),
    );
  });
});
