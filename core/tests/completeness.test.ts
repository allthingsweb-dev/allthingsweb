import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Duration, Effect, Layer } from "effect";
import {
  Completeness,
  type EventCompleteness,
  type EventRecord,
  eventCompleteness,
  gapKinds,
  mustHaveTalks,
  mustHaveVenues,
  requiredGaps,
} from "../src/completeness.ts";
import { formatReport, reportJson } from "../src/completeness-report.ts";
import { defaultTagline } from "../src/tagline.ts";
import {
  clockLayer,
  now,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * The completeness report: the rules on hand-made records, the repository
 * on tests/seed.sql read at 2026-10-03T19:00:00Z, and the text and JSON an
 * organizer or a tool gets.
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const person = (
  id: string,
  overrides: Partial<EventRecord["talks"][number]["speakers"][number]> = {},
) => ({
  id,
  name: `Person ${id}`,
  title: "Engineer",
  bio: "Builds things.",
  hasPhoto: true,
  twitterHandle: "someone",
  blueskyHandle: null,
  linkedinHandle: null,
  xHandleLost: null,
  ...overrides,
});

/** A past evening with nothing missing; each test takes something away. */
const complete: EventRecord = {
  slug: "2026-09-01-all-things-effect",
  name: "All Things Effect",
  topic: null,
  tagline: "Typed errors, on a rooftop",
  description: null,
  lumaDescription: "<p>Michael Arnaldi joins us on the rooftop.</p>",
  lumaSummary: "Michael Arnaldi joins us on the rooftop.",
  startDate: at("2026-09-02T00:30:00Z"),
  endDate: at("2026-09-02T03:30:00Z"),
  streetAddress: "201 Spear St",
  fullAddress: "201 Spear St, San Francisco, CA 94105",
  lumaEventId: "evt-effect",
  recordingUrl: "https://www.youtube.com/watch?v=abc",
  program: "talks",
  curation: { kind: "ours" },
  hasCover: true,
  lumaGuestCount: 183,
  photos: 12,
  talks: [
    {
      title: "Effect in production",
      description: "<p>Typed errors.</p>",
      speakers: [person("a")],
    },
  ],
  hosts: [
    {
      name: "CodeRabbit",
      about: "Rooftop and pizza.",
      hasLogo: true,
      websiteUrl: "https://www.coderabbit.ai",
      twitterHandle: "coderabbitai",
      blueskyHandle: null,
      linkedinHandle: null,
    },
  ],
  people: [{ role: "organizer", person: person("o") }],
};

const after = at("2026-10-03T19:00:00Z");
const gapsOf = (record: EventRecord, instant = after) =>
  eventCompleteness(record, instant).gaps.map((g) =>
    g.subject === null ? g.kind : `${g.kind}: ${g.subject}`,
  );

describe("what an event lacks", () => {
  test("a complete record lacks nothing", () => {
    expect(eventCompleteness(complete, after)).toEqual({
      slug: complete.slug,
      name: complete.name,
      status: "past",
      program: "talks",
      curation: "ours",
      startDate: complete.startDate,
      endDate: complete.endDate,
      talks: 1,
      speakers: 1,
      people: 1,
      hosts: 1,
      photos: 12,
      guests: 183,
      gaps: [],
    });
  });

  test("talks, their speakers and descriptions", () => {
    expect(gapsOf({ ...complete, talks: [] })).toEqual(["talks"]);
    expect(
      gapsOf({
        ...complete,
        talks: [
          { title: "Panel", description: "<p> </p>&nbsp;", speakers: [] },
        ],
      }),
    ).toEqual(["talk-speakers: Panel", "talk-description: Panel"]);
  });

  test("only an evening of talks is asked for talks", () => {
    expect(gapsOf({ ...complete, talks: [] })).toEqual(["talks"]);
    for (const program of ["open-floor", "social", "hackathon"] as const) {
      expect(gapsOf({ ...complete, program, talks: [] })).toEqual([]);
    }
  });

  test("still checks what an open floor's known demos say", () => {
    expect(
      gapsOf({
        ...complete,
        program: "open-floor",
        talks: [{ title: "A demo", description: "", speakers: [] }],
      }),
    ).toEqual(["talk-speakers: A demo", "talk-description: A demo"]);
  });

  test("a shared evening needs no people of ours, and no topic", () => {
    const shared = {
      ...complete,
      topic: null,
      name: "TypeScript AI Demo Day",
      curation: {
        kind: "shared",
        organizer: {
          name: "Mastra",
          websiteUrl: "https://mastra.ai",
          twitterHandle: "mastra",
          blueskyHandle: null,
          linkedinHandle: null,
        },
      },
      people: [],
    } as const;
    expect(gapsOf(shared)).toEqual([]);
    expect(eventCompleteness(shared, after).curation).toBe("shared");
    // Its talks are still checked.
    expect(gapsOf({ ...shared, talks: [] })).toEqual(["talks"]);
  });

  test("its people, and an organizer among them", () => {
    expect(gapsOf({ ...complete, people: [] })).toEqual(["people"]);
    expect(
      gapsOf({
        ...complete,
        people: [{ role: "co-host", person: person("c") }],
      }),
    ).toEqual(["organizer"]);
  });

  test("everyone named on the event is checked once, speakers first", () => {
    const sparse = person("s", {
      name: "Sparse",
      title: " ",
      bio: "<p></p>",
      hasPhoto: false,
      twitterHandle: "",
    });
    expect(
      gapsOf({
        ...complete,
        talks: [{ ...complete.talks[0]!, speakers: [sparse] }],
        people: [
          { role: "organizer", person: person("o") },
          { role: "mc", person: sparse },
        ],
      }),
    ).toEqual([
      "person-title: Sparse",
      "person-bio: Sparse",
      "person-photo: Sparse",
      "person-links: Sparse",
    ]);
  });

  test("hosts and what is known about them", () => {
    expect(gapsOf({ ...complete, hosts: [] })).toEqual(["hosts"]);
    expect(
      gapsOf({
        ...complete,
        hosts: [
          {
            name: "Acme",
            about: "",
            hasLogo: false,
            websiteUrl: null,
            twitterHandle: null,
            blueskyHandle: null,
            linkedinHandle: null,
          },
        ],
      }),
    ).toEqual([
      "host-logo: Acme",
      "host-about: Acme",
      "host-website: Acme",
      "host-links: Acme",
    ]);
    // A website that is no http(s) URL is never linked; any one handle is a link.
    expect(
      gapsOf({
        ...complete,
        hosts: [
          {
            name: "Acme",
            about: "Space.",
            hasLogo: true,
            websiteUrl: "javascript:alert(1)",
            twitterHandle: null,
            blueskyHandle: " ",
            linkedinHandle: "acme",
          },
        ],
      }),
    ).toEqual(["host-website: Acme"]);
  });

  test("venue, lockup topic, description, tagline and cover", () => {
    expect(
      gapsOf({ ...complete, fullAddress: null, streetAddress: "  " }),
    ).toEqual(["venue"]);
    // Neither the name nor the site gives the lockup a topic.
    expect(
      gapsOf({ ...complete, name: "Dev Setup Demos - Show your agents.md!" }),
    ).toEqual(["topic"]);
    expect(
      gapsOf({
        ...complete,
        name: "Dev Setup Demos - Show your agents.md!",
        topic: "dev setups",
      }),
    ).toEqual([]);
    // The site's description, or Luma's: either one will do.
    expect(
      gapsOf({ ...complete, lumaDescription: "<p> </p>", lumaSummary: null }),
    ).toEqual(["description"]);
    expect(
      gapsOf({
        ...complete,
        description: "<p>Our own words.</p>",
        lumaDescription: null,
      }),
    ).toEqual([]);
    // A placeholder tagline is a gap only without a summary to stand in.
    expect(gapsOf({ ...complete, tagline: defaultTagline })).toEqual([]);
    for (const tagline of [defaultTagline, " "]) {
      expect(gapsOf({ ...complete, tagline, lumaSummary: null })).toEqual([
        "tagline",
      ]);
    }
    expect(gapsOf({ ...complete, hasCover: false })).toEqual(["cover"]);
  });

  test("photos, a recording and Luma's count are asked of past events only", () => {
    const bare = {
      ...complete,
      photos: 0,
      recordingUrl: null,
      lumaGuestCount: null,
    };
    expect(gapsOf(bare)).toEqual(["photos", "recording", "guest-count"]);
    // A stored recording that is no http(s) URL is never published.
    expect(
      gapsOf({ ...complete, recordingUrl: "javascript:alert(1)" }),
    ).toEqual(["recording"]);
    // Without a Luma event there is no count to ask for.
    expect(gapsOf({ ...bare, lumaEventId: null })).toEqual([
      "photos",
      "recording",
    ]);
    // Live, and still ahead.
    expect(gapsOf(bare, at("2026-09-02T01:00:00Z"))).toEqual([]);
    expect(gapsOf(bare, at("2026-08-01T00:00:00Z"))).toEqual([]);
  });

  test("required and optional gaps", () => {
    const report = eventCompleteness(
      { ...complete, talks: [], recordingUrl: null },
      after,
    );
    expect(report.gaps.map((g) => g.kind)).toEqual(["talks", "recording"]);
    expect(requiredGaps(report).map((g) => g.kind)).toEqual(["talks"]);
    expect(
      Object.entries(gapKinds)
        .filter(([, kind]) => !kind.required)
        .map(([name]) => name),
    ).toEqual([
      "person-links",
      "person-x-handle-lost",
      "host-website",
      "host-links",
      "cover",
      "recording",
      "guest-count",
    ]);
  });

  test("flags a person whose X handle someone else has now", () => {
    expect(
      gapsOf({
        ...complete,
        talks: [
          {
            ...complete.talks[0]!,
            speakers: [
              person("a", { twitterHandle: null, xHandleLost: "ada" }),
            ],
          },
        ],
      }),
    ).toContain("person-x-handle-lost: Person a (@ada)");
    expect(gapsOf(complete)).not.toContainEqual(
      expect.stringContaining("person-x-handle-lost"),
    );
  });
});

describe("the weekly check", () => {
  const ended = (iso: string, record: Partial<EventRecord> = {}) =>
    eventCompleteness(
      {
        ...complete,
        slug: iso,
        startDate: DateTime.subtractDuration(at(iso), Duration.hours(3)),
        endDate: at(iso),
        talks: [],
        ...record,
      },
      after,
    );

  test("fails on events without talks that ended in the window", () => {
    const reports: ReadonlyArray<EventCompleteness> = [
      ended("2026-10-03T18:59:00Z"),
      ended("2026-09-03T19:00:00Z"),
      ended("2026-09-03T18:59:59Z"),
      ended("2026-09-20T00:00:00Z", { talks: complete.talks }),
      ended("2026-09-21T00:00:00Z", { program: "hackathon" }),
      ended("2026-09-22T00:00:00Z", { program: "open-floor" }),
      ended("2026-09-23T00:00:00Z", { program: "social" }),
      // Not over yet.
      ended("2026-10-03T20:00:00Z"),
    ];
    expect(mustHaveTalks(reports, after).map((r) => r.slug)).toEqual([
      "2026-10-03T18:59:00Z",
      "2026-09-03T19:00:00Z",
    ]);
    expect(
      mustHaveTalks(reports, after, Duration.days(7)).map((r) => r.slug),
    ).toEqual(["2026-10-03T18:59:00Z"]);
  });

  test("fails on every evening without a venue, however long ago, and on upcoming ones", () => {
    const nowhere = { fullAddress: null, streetAddress: null };
    const reports: ReadonlyArray<EventCompleteness> = [
      ended("2024-04-30T03:30:00Z", nowhere),
      ended("2026-10-03T18:59:00Z", { ...nowhere, program: "social" }),
      ended("2026-12-01T03:30:00Z", { ...nowhere, streetAddress: "  " }),
      ended("2026-09-01T03:30:00Z"),
      ended("2026-09-02T03:30:00Z", { fullAddress: null }),
    ];
    expect(mustHaveVenues(reports).map((r) => r.slug)).toEqual([
      "2024-04-30T03:30:00Z",
      "2026-10-03T18:59:00Z",
      "2026-12-01T03:30:00Z",
    ]);
  });
});

const db = await seededDatabase();
afterAll(() => db.close());

describe("Completeness", () => {
  const report = () =>
    Effect.runPromise(
      Completeness.use((c) => c.report).pipe(
        Effect.provide(
          Completeness.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );

  test("reports every published event, latest first, at the Clock's now", async () => {
    const reports = await report();
    expect(
      reports.map((r) => [
        r.slug,
        r.status,
        r.talks,
        r.speakers,
        r.people,
        r.hosts,
        r.photos,
        r.guests,
      ]),
    ).toEqual([
      ["2026-11-05-upcoming", "upcoming", 1, 1, 0, 0, 0, null],
      ["2026-10-03-hack-day", "live", 1, 1, 0, 0, 0, null],
      ["2026-10-03-ends-now", "live", 1, 1, 0, 0, 0, null],
      ["2026-08-12-react-at-acme", "past", 2, 3, 0, 2, 2, 118],
      ["2025-12-02-café-night", "past", 2, 3, 0, 0, 0, null],
    ]);
    expect(
      reports.find((r) => r.slug === "2026-08-12-react-at-acme")?.gaps,
    ).toEqual([
      { kind: "people", subject: null },
      { kind: "person-title", subject: "Linus" },
      { kind: "person-photo", subject: "Linus" },
      { kind: "person-bio", subject: "Grace Hopper" },
      { kind: "person-photo", subject: "Grace Hopper" },
      { kind: "host-logo", subject: "Globex" },
      { kind: "host-website", subject: "Globex" },
      { kind: "host-links", subject: "Globex" },
    ]);
    expect(
      reports
        .find((r) => r.slug === "2025-12-02-café-night")
        ?.gaps.map((g) => g.kind),
    ).toEqual([
      "people",
      "person-title",
      "person-photo",
      "person-bio",
      "person-photo",
      "hosts",
      "description",
      "cover",
      "photos",
      "recording",
    ]);
  });

  test("checks the people recorded on the event, with the speakers", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(`
        INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'organizer', 0, 'luma', now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000007', 'co-host', 0, 'luma', now());
      `);
      const reports = await Effect.runPromise(
        Completeness.use((c) => c.report).pipe(
          Effect.provide(
            Completeness.layer.pipe(
              Layer.provideMerge(sqlLayer(database)),
              Layer.provideMerge(clockLayer),
            ),
          ),
        ),
      );
      const acme = reports.find((r) => r.slug === "2026-08-12-react-at-acme");
      expect(acme?.people).toBe(2);
      expect(acme?.gaps.map((g) => `${g.kind}: ${g.subject}`)).toEqual([
        "person-title: Linus",
        "person-photo: Linus",
        "person-bio: Grace Hopper",
        "person-photo: Grace Hopper",
        "person-photo: Unattached",
        "person-links: Unattached",
        "host-logo: Globex",
        "host-website: Globex",
        "host-links: Globex",
      ]);
    } finally {
      await database.close();
    }
  });

  test("prints a table of every event, then each one's gaps", async () => {
    const text = formatReport(await report());
    const [header, rule, ...rest] = text.split("\n");
    expect(header).toBe(
      "date        status    program    event                     talks  speakers  people  hosts  photos  guests  gaps  optional",
    );
    expect(rule).toStartWith("----------  --------  ---------  ");
    expect(rest.slice(0, 5)).toEqual([
      "2026-11-05  upcoming  talks      2026-11-05-upcoming           1         1       0      0       0       -     5         1",
      "2026-10-03  live      hackathon  2026-10-03-hack-day           1         1       0      0       0       -     5         1",
      "2026-10-03  live      talks      2026-10-03-ends-now           1         1       0      0       0       -     6         2",
      "2026-08-12  past      talks      2026-08-12-react-at-acme      2         3       0      2       2     118     6         2",
      "2025-12-02  past      talks      2025-12-02-café-night         2         3       0      0       0       -     8         2",
    ]);
    expect(text).toContain(
      [
        "2026-08-12 React at Acme (2026-08-12-react-at-acme)",
        "  - no organizers, co-hosts or MC",
        "  - person without title: Linus",
        "  - person without bio: Grace Hopper",
        "  - person without photo: Linus, Grace Hopper",
        "  - host without logo: Globex",
      ].join("\n"),
    );
    expect(text).toContain(
      '0 of 5 published events lack nothing required. "-" is required, "~" optional.',
    );
  });

  test("serves the same report as JSON, instants in ISO 8601", async () => {
    const [upcoming] = reportJson(await report());
    expect(upcoming).toMatchObject({
      slug: "2026-11-05-upcoming",
      startDate: "2026-11-06T02:00:00.000Z",
      endDate: "2026-11-06T05:00:00.000Z",
    });
    expect(upcoming?.gaps[0]).toEqual({
      kind: "people",
      subject: null,
      required: true,
    });
    expect(DateTime.formatIso(now)).toBe("2026-10-03T19:00:00.000Z");
  });
});
