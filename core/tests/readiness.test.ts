import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, DateTime, Effect, Exit, Layer } from "effect";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import {
  grantStatements as readerGrants,
  SITE_READER,
} from "../../infra/scripts/site-reader.ts";
import type { EventRecord } from "../src/completeness.ts";
import { formats, openSourceProjects, scheduleLines } from "../src/formats.ts";

const [lightning, fullDaySize] = formats.hackathon.sizes;
if (fullDaySize === undefined) throw new Error("no full-day hackathon");
import { Planning } from "../src/planning/planning.ts";
import { addDays, sfDay, weekdayOf } from "../src/readiness/calendar.ts";
import {
  type CalendarEvent,
  type DraftFacts,
  draftChecks,
} from "../src/readiness/checks.ts";
import { formatReadiness } from "../src/readiness/format.ts";
import { type DraftRef, Readiness } from "../src/readiness/readiness.ts";
import {
  dateWindow,
  type NetworkPerson,
  openDates,
  quietHosts,
  rankSpeakers,
  rankWanted,
  type Wanted,
  wordsOf,
} from "../src/readiness/suggestions.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Readiness (src/readiness/): the checks and suggestions on hand-made
 * records, then the report on tests/seed.sql at 2026-10-03T19:00:00Z, as
 * the owner and as site_reader. Planning rows here are made up in this
 * file (tests/planning-privacy.test.ts).
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);
const now = at("2026-10-03T19:00:00Z");

const person = (id: string) => ({
  id,
  name: `Person ${id}`,
  title: "Engineer",
  bio: "Builds things.",
  hasPhoto: true,
  twitterHandle: "someone",
  blueskyHandle: null,
  linkedinHandle: null,
  xHandleLost: null,
});

/** A draft evening with nothing missing, three weeks out; each test takes something away. */
const ready: EventRecord = {
  slug: "2026-10-27-made-up",
  name: "All Things Made Up",
  topic: "made up",
  tagline: "Something real",
  description: null,
  lumaDescription: "<p>Something real, on a rooftop.</p>",
  lumaSummary: "Something real, on a rooftop.",
  // 5:30 PM in San Francisco.
  startDate: at("2026-10-28T00:30:00Z"),
  endDate: at("2026-10-28T03:30:00Z"),
  streetAddress: "201 Spear St",
  fullAddress: "201 Spear St, San Francisco, CA 94105",
  lumaEventId: "evt-made-up",
  recordingUrl: null,
  program: "talks",
  curation: { kind: "ours" },
  hasCover: true,
  lumaGuestCount: null,
  photos: 0,
  talks: [
    {
      title: "A talk",
      description: "<p>About something.</p>",
      speakers: [person("s1")],
    },
  ],
  hosts: [
    {
      name: "CodeRabbit",
      about: "Reviews code.",
      hasLogo: true,
      websiteUrl: "https://coderabbit.ai",
      twitterHandle: "coderabbitai",
      blueskyHandle: null,
      linkedinHandle: null,
    },
  ],
  people: [{ role: "organizer", person: person("o1") }],
};

const facts = (
  overrides: Partial<EventRecord> = {},
  more: Partial<DraftFacts> = {},
): DraftFacts => ({
  record: { ...ready, ...overrides },
  isDraft: true,
  shortLocation: "CodeRabbit",
  scheduleItems: 0,
  ...more,
});

const kinds = (checks: ReadonlyArray<{ kind: string; level: string }>) =>
  checks.map((check) => `${check.level} ${check.kind}`);

const calendarEvent = (
  slug: string,
  start: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  slug,
  name: slug,
  startDate: at(start),
  endDate: at(start),
  isDraft: false,
  curation: "ours",
  ...overrides,
});

describe("draftChecks", () => {
  test("a complete draft is ready, and past-only gaps are never asked", () => {
    // No photos, recording or guest count: a draft can't have them yet.
    expect(draftChecks(facts(), [], now)).toEqual([]);
  });

  test("the completeness rules run ahead of time, required ones blocking", () => {
    const checks = draftChecks(
      facts({
        hosts: [],
        talks: [],
        people: [],
        tagline: "",
        lumaSummary: null,
      }),
      [],
      now,
    );
    expect(kinds(checks)).toEqual([
      "blocker talks",
      "blocker people",
      "blocker hosts",
      "blocker tagline",
    ]);
    expect(checks[0]?.message).toBe("No talks");
  });

  test("a social evening is asked for no talks; a hackathon for its schedule and its rules", () => {
    expect(
      draftChecks(facts({ program: "social", talks: [] }), [], now),
    ).toEqual([]);
    const hackathon = facts({ program: "hackathon", talks: [] });
    const checks = draftChecks(hackathon, [], now);
    expect(kinds(checks)).toEqual([
      "blocker rules",
      "blocker rules",
      "blocker rules",
      "blocker schedule",
    ]);
    // Three hours: the schedule it lacks starts from a lightning one's.
    expect(checks[3]?.message).toBe(
      `Its page needs a schedule, as every hackathon's does. Start from: ${scheduleLines(lightning).join("; ")}.`,
    );
    expect(checks.map((entry) => entry.subject).slice(0, 3)).toEqual([
      "open-source, in Luma's description",
      "judging, in Luma's description",
      "starter, in Luma's description",
    ]);
    expect(
      draftChecks(
        facts(
          {
            program: "hackathon",
            talks: [],
            lumaDescription: `<p>Build something.</p><p><strong>Rules</strong></p><ul>${formats.hackathon.rules.map((rule) => `<li>${rule.text}</li>`).join("")}</ul>`,
          },
          { scheduleItems: 3 },
        ),
        [],
        now,
      ),
    ).toEqual([]);
  });

  test("a hackathon without a description yet is told the rules it must carry", () => {
    const checks = draftChecks(
      facts(
        { program: "hackathon", talks: [], lumaDescription: null },
        { scheduleItems: 3 },
      ),
      [],
      now,
    );
    expect(kinds(checks)).toEqual(["advice description", "advice rules"]);
    expect(checks[1]?.message).toContain(openSourceProjects.text);
  });

  test("a rule is never asked of an evening before its day, or of one we only share", () => {
    const before = DateTime.makeUnsafe("2026-10-05T16:00:00Z");
    for (const overrides of [
      // Starts the day before the rule, in San Francisco.
      {
        startDate: at("2026-10-05T17:00:00Z"),
        endDate: at("2026-10-06T01:00:00Z"),
      },
      {
        curation: {
          kind: "shared" as const,
          organizer: {
            name: "Mastra",
            websiteUrl: "https://mastra.ai",
            twitterHandle: "mastra",
            blueskyHandle: null,
            linkedinHandle: null,
          },
        },
      },
    ]) {
      expect(
        kinds(
          draftChecks(
            facts(
              { program: "hackathon", talks: [], ...overrides },
              { scheduleItems: 3 },
            ),
            [],
            before,
          ),
        ),
      ).not.toContain("blocker rules");
    }
  });

  test("a length is a default: another is advised on, the six-hour limit stays", () => {
    // Doors at 5:30 PM, four hours.
    const longer = draftChecks(
      facts({ endDate: at("2026-10-28T04:30:00Z") }),
      [],
      now,
    );
    expect(kinds(longer)).toEqual(["advice length"]);
    expect(longer[0]?.message).toBe(
      "Runs 4 hours, doors to close; an evening of talks runs 3 hours by default. Keep it if it's meant.",
    );
    expect(
      kinds(
        draftChecks(facts({ endDate: at("2026-10-28T07:00:00Z") }), [], now),
      ),
    ).toEqual(["advice long", "advice length"]);
  });

  test("a hackathon is lightning up to four hours; past that, full-day, which is confirmed", () => {
    const hackathon = (start: string, end: string) =>
      draftChecks(
        facts(
          {
            program: "hackathon",
            talks: [],
            startDate: at(start),
            endDate: at(end),
            lumaDescription: `<ul>${formats.hackathon.rules.map((rule) => `<li>${rule.text}</li>`).join("")}</ul>`,
          },
          { scheduleItems: 3 },
        ),
        [],
        now,
      );
    // 5:30 to 8:30 PM: a lightning one, as long as its default.
    expect(hackathon("2026-10-28T00:30:00Z", "2026-10-28T03:30:00Z")).toEqual(
      [],
    );
    // 5:30 to 9:30 PM: still lightning, longer than its default.
    expect(
      kinds(hackathon("2026-10-28T00:30:00Z", "2026-10-28T04:30:00Z")),
    ).toEqual(["advice length"]);
    // A lightning one is an evening: in the morning it reads as daytime.
    expect(
      kinds(hackathon("2026-10-27T17:00:00Z", "2026-10-27T20:00:00Z")),
    ).toEqual(["advice daytime"]);
    // 9 AM to 5 PM: full-day, through the day, and confirmed.
    const fullDay = hackathon("2026-10-27T16:00:00Z", "2026-10-28T00:00:00Z");
    expect(kinds(fullDay)).toEqual(["advice size"]);
    expect(fullDay[0]?.message).toBe(fullDaySize.confirm ?? "");
  });

  test("a cover blocks only once the Luma event exists", () => {
    expect(kinds(draftChecks(facts({ hasCover: false }), [], now))).toEqual([
      "blocker cover",
    ]);
    expect(
      kinds(
        draftChecks(facts({ hasCover: false, lumaEventId: null }), [], now),
      ),
    ).toEqual(["advice luma-event", "advice cover"]);
  });

  test("the date is ahead, ends after it starts, and reads as an evening", () => {
    expect(
      kinds(
        draftChecks(
          facts({
            startDate: at("2026-10-01T00:30:00Z"),
            endDate: at("2026-10-01T00:00:00Z"),
          }),
          [],
          now,
        ),
      ),
    ).toEqual(["blocker starts-in-past", "blocker ends-before-start"]);
    expect(
      kinds(
        draftChecks(
          facts({
            // 10 AM to 6 PM in San Francisco.
            startDate: at("2026-10-27T17:00:00Z"),
            endDate: at("2026-10-28T01:00:00Z"),
          }),
          [],
          now,
        ),
      ),
    ).toEqual(["advice daytime", "advice long", "advice length"]);
  });

  test("another of our evenings that day blocks; a draft or a shared one is advice", () => {
    const checks = draftChecks(
      facts(),
      [
        calendarEvent(ready.slug, "2026-10-28T00:30:00Z"),
        calendarEvent("ours", "2026-10-27T18:00:00Z"),
        calendarEvent("theirs", "2026-10-28T02:00:00Z", { curation: "shared" }),
        calendarEvent("draft", "2026-10-28T01:00:00Z", { isDraft: true }),
        calendarEvent("next-day", "2026-10-28T16:00:00Z"),
      ],
      now,
    );
    expect(checks.map((check) => `${check.level} ${check.subject}`)).toEqual([
      "blocker ours",
      "advice theirs",
      "advice draft",
    ]);
  });

  test("a venue is named and placed", () => {
    expect(
      kinds(
        draftChecks(
          facts(
            {
              streetAddress: "1 Nowhere Ln",
              fullAddress: "1 Nowhere Ln, Oakland, CA",
            },
            { shortLocation: null },
          ),
          [],
          now,
        ),
      ),
    ).toEqual(["advice venue-name", "advice neighborhood"]);
  });

  test("an evening already public says so", () => {
    expect(kinds(draftChecks(facts({}, { isDraft: false }), [], now))).toEqual([
      "advice published",
    ]);
  });
});

describe("suggestions", () => {
  test("wordsOf keeps words and their parts, without markup or filler", () => {
    expect(
      wordsOf("alpha-nerd trivia", "<p>The Next.js &amp; C++ night</p>"),
    ).toEqual(["alpha", "c++", "js", "nerd", "next", "next.js", "trivia"]);
  });

  const talk = (title: string, end: string, eventSlug = "e") => ({
    title,
    description: "",
    eventSlug,
    eventName: "Evening",
    eventTopic: null,
    endDate: at(end),
  });
  const network: ReadonlyArray<NetworkPerson> = [
    {
      profileId: "a",
      name: "Ada",
      talks: [talk("Effect in prod", "2025-01-01T00:00:00Z", "old")],
    },
    {
      profileId: "b",
      name: "Bo",
      talks: [talk("Effect and git", "2024-01-01T00:00:00Z")],
    },
    {
      profileId: "c",
      name: "Cy",
      talks: [talk("Effect at scale", "2026-01-01T00:00:00Z", "new")],
    },
    {
      profileId: "d",
      name: "Di",
      talks: [talk("CSS", "2026-02-01T00:00:00Z")],
    },
    {
      profileId: "e",
      name: "Ed",
      talks: [talk("Effect", "2026-09-01T00:00:00Z")],
    },
  ];

  test("speakers rank by shared words, then by how recently they spoke", () => {
    expect(
      rankSpeakers(["effect", "git"], network, new Set(["e"])).map((s) => [
        s.name,
        s.matched.join("+"),
        s.lastSpoke.slug,
      ]),
    ).toEqual([
      ["Bo", "effect+git", "e"],
      ["Cy", "effect", "new"],
      ["Ada", "effect", "old"],
    ]);
  });

  const wanted = (
    id: string,
    status: Wanted["status"],
    topics: ReadonlyArray<string>,
    availability: Wanted["availability"] = [],
  ): Wanted => ({
    id,
    name: id,
    profileId: null,
    status,
    topics,
    availability,
  });

  test("wanted speakers: confirmed first, free that day first, never declined", () => {
    expect(
      rankWanted(
        ["git"],
        [
          wanted("w1", "wanted", ["git"]),
          wanted(
            "w2",
            "asked",
            ["git"],
            [
              {
                kind: "unavailable",
                startsOn: "2026-10-01",
                endsOn: "2026-10-31",
              },
            ],
          ),
          wanted("w3", "asked", ["git"]),
          wanted("w4", "declined", ["git"]),
          wanted("w5", "confirmed", ["css"]),
        ],
        "2026-10-27",
        new Set(),
      ).map((s) => `${s.id} ${s.status} ${s.freeThatDay}`),
    ).toEqual(["w3 asked true", "w2 asked false", "w1 wanted true"]);
  });

  test("quiet hosts: none within 90 days, longest since first", () => {
    const host = (id: string, last: string, evenings = 1) => ({
      sponsorId: id,
      name: id,
      evenings,
      lastHosted: at(last),
      lastAddress: null,
    });
    expect(
      quietHosts(
        [
          host("recent", "2026-09-01T01:00:00Z"),
          host("older", "2026-03-01T01:00:00Z"),
          host("oldest", "2025-01-01T01:00:00Z"),
          host("busy", "2026-03-01T01:00:00Z", 4),
          host("this one", "2024-01-01T01:00:00Z"),
        ],
        "2026-10-27",
        new Set(["this one"]),
      ).map((h) => h.name),
    ).toEqual(["oldest", "busy", "older"]);
  });

  test("open dates keep to our usual weekdays, clear of the calendar and spaced from ours", () => {
    // Our evenings have been on Tuesdays (three) and Wednesdays (two), and once on a Friday and a Monday.
    const ours = [
      "2026-06-02T01:00:00Z", // Mon 1 Jun
      "2026-06-10T01:00:00Z", // Tue 9 Jun
      "2026-06-17T01:00:00Z", // Tue 16 Jun
      "2026-06-24T01:00:00Z", // Tue 23 Jun
      "2026-07-02T01:00:00Z", // Wed 1 Jul
      "2026-07-09T01:00:00Z", // Wed 8 Jul
      "2026-07-11T01:00:00Z", // Fri 10 Jul
      "2026-10-21T01:00:00Z", // Tue 20 Oct, inside the window
    ].map((start, i) => calendarEvent(`ours-${i}`, start));
    const calendar = [
      ...ours,
      calendarEvent("shared", "2026-10-29T01:00:00Z", { curation: "shared" }), // Wed 28 Oct
    ];
    const window = dateWindow("2026-10-27", sfDay(now));
    expect(window).toEqual({ from: "2026-10-13", to: "2026-11-10" });
    const free = {
      kind: "available" as const,
      startsOn: "2026-11-01",
      endsOn: null,
    };
    const dates = openDates(calendar, window.from, window.to, null, [
      wanted("w", "wanted", ["git"], [free]),
    ]);
    expect(dates.weekdays).toEqual([1, 2, 3]);
    expect(
      dates.days.map((d) => `${d.day} ${d.weekday} ${d.wantedFree}`),
    ).toEqual([
      "2026-10-13 2 0",
      "2026-10-14 3 0",
      // 19 Oct through 23 Oct are within three days of the 20th.
      "2026-10-26 1 0",
      "2026-10-27 2 0",
      // The 28th has the shared evening.
      "2026-11-02 1 1",
      "2026-11-03 2 1",
      "2026-11-04 3 1",
      "2026-11-09 1 1",
    ]);
  });

  test("a draft whose day has passed gets the weeks ahead", () => {
    expect(dateWindow("2026-08-01", "2026-10-03")).toEqual({
      from: "2026-10-04",
      to: "2026-11-28",
    });
    expect(dateWindow(null, "2026-10-03")).toEqual({
      from: "2026-10-04",
      to: "2026-11-28",
    });
    expect(weekdayOf(addDays("2026-10-03", 1))).toBe(0);
  });
});

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const layer = () =>
  Readiness.layer.pipe(
    Layer.provideMerge(Planning.layer),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );

const report = (draft: DraftRef, topics: ReadonlyArray<string> = []) =>
  Effect.runPromise(
    Readiness.use((r) => r.report(draft, { topics })).pipe(
      Effect.provide(layer()),
    ),
  );

const refusal = async (draft: DraftRef) => {
  const exit = await Effect.runPromiseExit(
    Readiness.use((r) => r.report(draft)).pipe(Effect.provide(layer())),
  );
  if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const plan = <A, E>(
  f: (planning: Planning["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Planning.use(f).pipe(
      Effect.provide(
        Planning.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );

describe("the report", () => {
  test("a draft the sync stored, checked and suggested for", async () => {
    // Its day has passed at the test clock; give it one ahead, and a venue.
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z',
      street_address = '201 Spear St', full_address = '201 Spear St, San Francisco, CA 94105'
      WHERE slug = '2026-09-01-draft-night'`);
    const result = await report(
      { _tag: "Event", slug: "2026-09-01-draft-night" },
      ["effect"],
    );
    expect(result.subject).toMatchObject({
      kind: "event",
      slug: "2026-09-01-draft-night",
      isDraft: true,
      day: "2026-10-27",
    });
    expect(result.ready).toBe(false);
    expect(kinds(result.checks)).toEqual([
      "blocker people",
      "blocker person-photo",
      "blocker hosts",
      "blocker cover",
      "advice person-links",
      "advice description",
    ]);
    expect(result.suggestions.terms).toEqual(["draft", "effect"]);
    expect(result.suggestions.speakers.network.map((s) => s.name)).toEqual([
      "Linus",
    ]);
    expect(result.planning).toBe("read");
    expect(formatReadiness(result)).toContain(
      "✗ not ready: 4 things block publishing",
    );
  });

  test("an idea, with and then through its draft evening", async () => {
    const idea = await plan((p) =>
      p.addIdea({
        title: "Made-up quiz",
        pitch: "Rounds.",
        program: "social",
        topic: "quiz",
        inspiredBySlug: "2026-08-12-react-at-acme",
      }),
    );
    await plan((p) =>
      p.addWantedSpeaker(
        { _tag: "Profile", ref: "Ada Lovelace" },
        { topics: ["quiz"] },
      ),
    );
    await plan((p) =>
      p.addHostProspect({ _tag: "NewCompany", name: "Made-up Co" }, undefined, {
        status: "asked",
      }),
    );
    const alone = await report({ _tag: "Idea", id: idea.id });
    expect(alone.subject).toEqual({
      kind: "idea",
      id: idea.id,
      title: "Made-up quiz",
      program: "social",
      topic: "quiz",
    });
    expect(kinds(alone.checks)).toEqual(["blocker luma-event"]);
    expect(alone.suggestions.speakers.lineup).toBe(false);
    expect(alone.suggestions.speakers.wanted.map((w) => w.name)).toEqual([
      "Ada Lovelace",
    ]);
    expect(alone.suggestions.hosts.prospects).toEqual([
      {
        id: expect.any(String),
        name: "Made-up Co",
        status: "asked",
        lastHosted: null,
      },
    ]);
    expect(alone.suggestions.attendees).toEqual({
      listsStored: false,
      inspiredBy: { slug: "2026-08-12-react-at-acme", guests: 118 },
    });

    await plan((p) =>
      p.updateIdea(idea.id, {
        status: "drafting",
        eventSlug: "2026-09-01-draft-night",
      }),
    );
    const drafted = await report({ _tag: "Idea", id: idea.id });
    expect(drafted.subject).toMatchObject({
      kind: "event",
      slug: "2026-09-01-draft-night",
    });
    expect(drafted.idea?.id).toBe(idea.id);
    expect(
      (await report({ _tag: "Event", slug: "2026-09-01-draft-night" })).idea
        ?.id,
    ).toBe(idea.id);
  });

  test("a draft from an idea is checked as the idea's kind of evening", async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z',
      street_address = '201 Spear St', full_address = '201 Spear St, San Francisco, CA 94105'
      WHERE slug = '2026-09-01-draft-night';
      DELETE FROM event_talks WHERE event_id = (SELECT id FROM events WHERE slug = '2026-09-01-draft-night');`);
    const slug = "2026-09-01-draft-night";
    const asTalks = await report({ _tag: "Event", slug });
    expect(asTalks.subject).toMatchObject({ program: "talks" });
    expect(kinds(asTalks.checks)).toContain("blocker talks");

    const idea = await plan((p) =>
      p.addIdea({
        title: "Made-up quiz",
        pitch: "Rounds.",
        program: "social",
        status: "drafting",
        eventSlug: slug,
      }),
    );
    const asSocial = await report({ _tag: "Event", slug });
    expect(asSocial.subject).toMatchObject({ program: "social" });
    expect(kinds(asSocial.checks)).not.toContain("blocker talks");
    expect(asSocial.suggestions.speakers.lineup).toBe(false);
    // The event's own program is unchanged: publish applies the idea's.
    const [row] = (
      await db.query<{ program: string }>(
        `SELECT program FROM events WHERE slug = '${slug}'`,
      )
    ).rows;
    expect(row?.program).toBe("talks");

    await plan((p) => p.updateIdea(idea.id, { status: "dropped" }));
    expect((await report({ _tag: "Event", slug })).subject).toMatchObject({
      program: "talks",
    });
  });

  test("a draft's private lineup counts as its people", async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z',
      street_address = '201 Spear St', full_address = '201 Spear St, San Francisco, CA 94105'
      WHERE slug = '2026-09-01-draft-night'`);
    const slug = "2026-09-01-draft-night";
    expect(kinds((await report({ _tag: "Event", slug })).checks)).toContain(
      "blocker people",
    );
    await plan((p) =>
      p.setDraftLineup(slug, [
        { role: "organizer", profile: "Ada Lovelace" },
        { role: "mc", profile: "Ada Lovelace" },
      ]),
    );
    const checks = kinds((await report({ _tag: "Event", slug })).checks);
    expect(checks).not.toContain("blocker people");
    expect(checks).not.toContain("blocker organizer");
  });

  test("refuses what isn't there", async () => {
    expect(await refusal({ _tag: "Event", slug: "nope" })).toBe(
      'No event, published or draft, has the slug "nope".',
    );
    expect(
      await refusal({
        _tag: "Idea",
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe("No idea has the id 00000000-0000-4000-8000-000000000000.");
  });

  test("as site_reader, it reports without planning, and says so", async () => {
    const owner: Statements = {
      unsafe: async (query, values) =>
        (await db.query(query, values === undefined ? [] : [...values])).rows,
    };
    await provisionLoginRole(owner, SITE_READER, "test-only");
    for (const statement of readerGrants()) await db.exec(statement);
    await db.exec(`SET ROLE ${SITE_READER}`);
    const result = await report({
      _tag: "Event",
      slug: "2026-09-01-draft-night",
    });
    expect(result.planning).toBe("not readable as this role");
    expect(result.idea).toBeNull();
    expect(result.suggestions.speakers.wanted).toEqual([]);
    expect(
      await refusal({
        _tag: "Idea",
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe(
      "Planning can't be read as this role, so no idea can be: run it as the database owner.",
    );
  });
});
