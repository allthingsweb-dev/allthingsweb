import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Layer, Option } from "effect";
import {
  LumaApi,
  type LumaApiError,
  LumaApiResponseError,
  type LumaEventPeople,
} from "../src/luma/api.ts";
import { LumaRejected } from "../src/luma/luma.ts";
import { formatImport } from "../src/luma/people-report.ts";
import {
  LumaPeopleSync,
  PeopleDecisionError,
  type PeopleImport,
} from "../src/luma/people-sync.ts";
import {
  type Decisions,
  type FetchedEvent,
  lumaPhotoUrl,
  noDecisions,
  normalizeName,
  planPeople,
  type StoredProfile,
} from "../src/luma/people.ts";
import { stageRole } from "../src/people.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * Who hosted each event and how many came, from Luma's API: the client
 * against fixtures written in the shape docs.luma.com documents, the plan as
 * a pure function, and the import against tests/seed.sql. No test reaches
 * Luma.
 */

const managed = await fixture("event-manage.json");
const viewed = await fixture("event-view.json");
const withKey = { LUMA_API_KEY: "test-key" };

/** A fake Luma answering by the event each request asks about. */
const fakeApi = (replies: Readonly<Record<string, ReadonlyArray<Reply>>>) =>
  fakeLumaBy((url) => url.searchParams.get("event_id") ?? "", replies);

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return undefined;
  const reason = exit.cause.reasons[0];
  return reason?._tag === "Fail" ? reason.error : reason;
};

describe("Luma's API", () => {
  const ask = (
    replies: ReadonlyArray<Reply>,
    env: Record<string, string> = withKey,
    lumaEventId = "evt-react",
  ) => {
    const luma = fakeApi({ [lumaEventId]: replies });
    return Effect.runPromiseExit(
      settle(
        LumaApi.use((api) =>
          Option.match(api.eventPeople, {
            onNone: (): Effect.Effect<
              "no key" | Option.Option<LumaEventPeople>,
              LumaApiError
            > => Effect.succeed("no key"),
            onSome: (eventPeople) => eventPeople(lumaEventId),
          }),
        ),
      ).pipe(
        Effect.provide(
          LumaApi.layer.pipe(
            Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    ).then((exit) => ({ exit, requests: luma.requests }));
  };

  test("has nothing to ask without LUMA_API_KEY", async () => {
    const { exit, requests } = await ask([{ body: managed }], {});
    expect(exit).toEqual(Exit.succeed("no key"));
    expect(requests).toEqual([]);
  });

  test("asks for one event with the key, and reads its hosts and guests", async () => {
    const { exit, requests } = await ask([{ body: managed }]);
    expect(
      requests.map(({ url, accept, apiKey }) => ({ url, accept, apiKey })),
    ).toEqual([
      {
        url: "https://public-api.luma.com/v1/events/get?event_id=evt-react",
        accept: "application/json",
        apiKey: "test-key",
      },
    ]);
    const people: LumaEventPeople = {
      lumaEventId: "evt-react",
      managed: true,
      hosts: [
        {
          lumaUserId: "usr-Hopper1",
          name: "Grace Hopper",
          avatarUrl: "https://images.lumacdn.com/avatars/gh/grace.jpg",
        },
        {
          lumaUserId: "usr-Hamilton1",
          name: "Margaret Hamilton",
          avatarUrl: "https://images.lumacdn.com/avatars/mh/margaret.jpg",
        },
        {
          lumaUserId: "usr-Lovelace1",
          name: "  ada   LOVELACE ",
          avatarUrl: "https://cdn.lu.ma/avatars-default/avatar_12.png",
        },
        {
          lumaUserId: "usr-Johnson1",
          name: "Katherine Johnson",
          avatarUrl: "https://cdn.lu.ma/avatars-default/avatar_7.png",
        },
        {
          lumaUserId: "usr-Nameless1",
          name: null,
          avatarUrl: "https://cdn.lu.ma/avatars-default/avatar_3.png",
        },
      ],
      guestCount: 183,
      checkedInCount: 141,
    };
    // Hosts' emails are in the answer; nothing keeps them.
    expect(exit).toEqual(Exit.succeed(Option.some(people)));
    expect(JSON.stringify(exit)).not.toContain("@example.com");
  });

  test("reads the hosts of an event another calendar manages, without counts", async () => {
    const { exit } = await ask([{ body: viewed }], withKey, "evt-partner");
    expect(exit).toEqual(
      Exit.succeed(
        Option.some({
          lumaEventId: "evt-partner",
          managed: false,
          hosts: [
            {
              lumaUserId: "usr-Hamilton1",
              name: "Margaret Hamilton",
              avatarUrl: "https://images.lumacdn.com/avatars/mh/margaret.jpg",
            },
            {
              lumaUserId: "usr-Future1",
              name: "Future Speaker",
              avatarUrl: "https://images.lumacdn.com/avatars/fs/future.jpg",
            },
          ],
          guestCount: null,
          checkedInCount: null,
        }),
      ),
    );
  });

  test.each([403, 404])(
    "an event Luma answers %i for is not shown to us",
    async (status) => {
      const { exit, requests } = await ask([{ status }]);
      expect(exit).toEqual(Exit.succeed(Option.none()));
      expect(requests).toHaveLength(1);
    },
  );

  test("a refused key fails at once", async () => {
    const { exit, requests } = await ask([{ status: 401 }]);
    const error = failure(exit);
    expect(error).toEqual(new LumaRejected({ status: 401, resource: "event" }));
    expect((error as LumaRejected).message).toBe(
      "Luma event request failed: 401",
    );
    expect(requests).toHaveLength(1);
  });

  test("tries again after a 5xx or a dropped connection", async () => {
    const { exit, requests } = await ask([
      { status: 503 },
      "drop",
      { body: managed },
    ]);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toHaveLength(3);
  });

  test.each([
    ["not JSON", "<html>"],
    ["no hosts", JSON.stringify({ id: "evt-react", access: "manage" })],
    [
      "a host without a Luma user id",
      JSON.stringify({
        id: "evt-react",
        access: "view",
        hosts: [{ id: "someone", name: "A", avatar_url: null }],
      }),
    ],
    ["a negative count", managed.replace('"guests": 183', '"guests": -1')],
    [
      "another event",
      managed.replace('"id": "evt-react"', '"id": "evt-other"'),
    ],
  ])("an answer with %s fails", async (_, body) => {
    const error = failure((await ask([{ body }])).exit);
    expect(error).toBeInstanceOf(LumaApiResponseError);
    expect((error as LumaApiResponseError).lumaEventId).toBe("evt-react");
  });
});

const profile = (
  id: string,
  name: string,
  lumaUserId: string | null = null,
  profileType: StoredProfile["profileType"] = "member",
): StoredProfile => ({ id, name, lumaUserId, profileType });

const hosted = (
  eventId: string,
  hosts: ReadonlyArray<[lumaUserId: string, name: string | null]>,
  counts: [number, number] | null = null,
): FetchedEvent => ({
  eventId,
  people: {
    lumaEventId: `evt-${eventId}`,
    managed: counts !== null,
    hosts: hosts.map(([lumaUserId, name]) => ({
      lumaUserId,
      name,
      avatarUrl: null,
    })),
    guestCount: counts?.[0] ?? null,
    checkedInCount: counts?.[1] ?? null,
  },
});

describe("planning the import", () => {
  test("matches by Luma user id, then by exact name; creates only whom an organizer decided", () => {
    const plan = planPeople(
      [
        hosted(
          "a",
          [
            ["usr-Org", "Renamed On Luma"],
            ["usr-Name", "Ada  Lovelace"],
            ["usr-New", "Margaret Hamilton"],
            ["usr-Unknown", "Katherine Johnson"],
          ],
          [10, 8],
        ),
      ],
      [
        profile("p-org", "Grace Hopper", "usr-Org", "organizer"),
        profile("p-ada", "ada lovelace"),
      ],
      { create: ["usr-New"], link: {} },
    );
    expect(plan.problems).toEqual([]);
    expect(plan.links).toEqual([
      { profileId: "p-ada", lumaUserId: "usr-Name" },
    ]);
    expect(plan.newProfiles).toEqual([
      {
        lumaUserId: "usr-New",
        name: "Margaret Hamilton",
        photoSourceUrl: null,
      },
    ]);
    expect(plan.people).toEqual([
      { eventId: "a", lumaUserId: "usr-Org", role: "organizer", position: 0 },
      { eventId: "a", lumaUserId: "usr-Name", role: "co-host", position: 0 },
      { eventId: "a", lumaUserId: "usr-New", role: "co-host", position: 1 },
    ]);
    expect(plan.replacedEventIds).toEqual(["a"]);
    expect(plan.guestCounts).toEqual([
      { eventId: "a", guestCount: 10, checkedInCount: 8 },
    ]);
    expect(plan.review).toEqual([
      {
        _tag: "Matched",
        how: "name",
        lumaEventId: "evt-a",
        lumaUserId: "usr-Name",
        name: "ada lovelace",
        profileId: "p-ada",
      },
      {
        _tag: "Created",
        lumaEventId: "evt-a",
        lumaUserId: "usr-New",
        name: "Margaret Hamilton",
      },
      {
        _tag: "Unmatched",
        lumaEventId: "evt-a",
        lumaUserId: "usr-Unknown",
        name: "Katherine Johnson",
        reason: "no profile has this name",
      },
    ]);
  });

  test("never guesses: unsettled hosts are reported, not matched or created", () => {
    const plan = planPeople(
      [
        hosted("a", [
          ["usr-Twice", "Sam Smith"],
          ["usr-Held", "Alex Kim"],
          ["usr-Same1", "Jo Lee"],
          ["usr-Same2", "jo  lee"],
          ["usr-Blank", "   "],
          ["usr-None", null],
          ["usr-Accent", "Sebastien Morel"],
          ["usr-Company", "Acme"],
        ]),
      ],
      [
        profile("p-1", "Sam Smith"),
        profile("p-2", "sam smith"),
        profile("p-3", "Alex Kim", "usr-Other"),
        profile("p-4", "Sébastien Morel"),
      ],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.links).toEqual([]);
    expect(plan.newProfiles).toEqual([]);
    expect(plan.people).toEqual([]);
    // The event's hosts are still replaced: none of them is imported.
    expect(plan.replacedEventIds).toEqual(["a"]);
    expect(
      plan.review.flatMap((review) =>
        review._tag === "Unmatched" ? [[review.lumaUserId, review.reason]] : [],
      ),
    ).toEqual([
      ["usr-Twice", "2 profiles have this name"],
      ["usr-Held", "the profile with this name belongs to another Luma user"],
      ["usr-Same1", "another Luma user goes by the same name"],
      ["usr-Same2", "another Luma user goes by the same name"],
      ["usr-Blank", "Luma shows no name for this host"],
      ["usr-None", "Luma shows no name for this host"],
      // "Sebastien" is not "Sébastien".
      ["usr-Accent", "no profile has this name"],
      ["usr-Company", "no profile has this name"],
    ]);
  });

  test("links a host to the profile an organizer named, whatever the names", () => {
    const plan = planPeople(
      [hosted("a", [["usr-Liz", "Liz Trykin"]])],
      [profile("p-liz", "Elizabeth Trykin")],
      { create: [], link: { "usr-Liz": "p-liz" } },
    );
    expect(plan.problems).toEqual([]);
    expect(plan.links).toEqual([{ profileId: "p-liz", lumaUserId: "usr-Liz" }]);
    expect(plan.review).toEqual([
      {
        _tag: "Matched",
        how: "decision",
        lumaEventId: "evt-a",
        lumaUserId: "usr-Liz",
        name: "Elizabeth Trykin",
        profileId: "p-liz",
      },
    ]);
  });

  test("lists every decision it cannot carry out", () => {
    const plan = planPeople(
      [
        hosted("a", [
          ["usr-Held", "Held Person"],
          ["usr-Both", "Both Ways"],
          ["usr-Nameless", null],
          ["usr-ToTaken", "To Taken"],
          ["usr-ToMissing", "To Missing"],
          ["usr-ByName", "Free Profile"],
          ["usr-AlsoFree", "Someone Else"],
        ]),
      ],
      [
        profile("p-held", "Held Person", "usr-Held"),
        profile("p-taken", "Taken", "usr-Taken"),
        profile("p-free", "Free Profile"),
        profile("p-both", "Both"),
      ],
      {
        create: ["usr-Both", "usr-Nameless", "usr-Typo"],
        link: {
          "usr-Held": "p-free",
          "usr-Both": "p-both",
          "usr-ToTaken": "p-taken",
          "usr-ToMissing": "p-nowhere",
          "usr-AlsoFree": "p-free",
        },
      },
    );
    expect(plan.problems).toEqual([
      "usr-Both is both to be created and linked",
      "usr-Typo is not a host of any event Luma showed us; nothing to decide",
      "usr-Held is already profile p-held (Held Person); unlink it there first",
      "usr-Nameless shows no name on Luma to make a profile with",
      "usr-ToTaken: profile p-taken (Taken) is already Luma user usr-Taken",
      "usr-ToMissing: no profile has the id p-nowhere",
      "usr-ByName and usr-AlsoFree would both be profile p-free (Free Profile)",
    ]);
  });

  test("a host of several events is matched or created once, and listed once per event", () => {
    const plan = planPeople(
      [
        hosted("a", [
          ["usr-New", "New Person"],
          ["usr-New", "New Person"],
        ]),
        hosted("b", [["usr-New", "New Person"]], [5, 0]),
        hosted("c", [], [7, 3]),
      ],
      [],
      { create: ["usr-New"], link: {} },
    );
    expect(plan.newProfiles).toHaveLength(1);
    expect(plan.people).toEqual([
      { eventId: "a", lumaUserId: "usr-New", role: "co-host", position: 0 },
      { eventId: "b", lumaUserId: "usr-New", role: "co-host", position: 0 },
    ]);
    // An event with no hosts listed keeps its rows, but its counts are new.
    expect(plan.replacedEventIds).toEqual(["a", "b"]);
    expect(plan.guestCounts.map((c) => c.eventId)).toEqual(["b", "c"]);
  });

  test.each([
    ["Ada Lovelace", "ada lovelace"],
    ["  Ada \t Lovelace\n", "ada lovelace"],
    // Composed and decomposed é are one name; accents still count.
    ["Sébastien", "sébastien"],
    ["Sébastien", "sébastien"],
    ["Sebastien", "sebastien"],
  ])("%j is matched as %j", (name, normalized) => {
    expect(normalizeName(name)).toBe(normalized);
  });

  test.each([
    ["https://images.lumacdn.com/avatars/q4/a.jpg", true],
    ["https://images.lumacdn.com/uploads/du/b.jpg", true],
    ["https://cdn.lu.ma/avatars-default/avatar_43.png", false],
    ["http://images.lumacdn.com/avatars/q4/a.jpg", false],
    ["https://images.lumacdn.com.evil.example/a.jpg", false],
    ["https://user:pw@images.lumacdn.com/a.jpg", false],
    ["not a url", false],
  ])("%s is a photo: %p", (url, isPhoto) => {
    expect(lumaPhotoUrl(url)).toBe(isPhoto ? url : null);
  });
});

describe("stage roles", () => {
  test.each([
    ["talk", "speaker", "speaker"],
    ["panel", "speaker", "panelist"],
    ["fireside", "speaker", "guest"],
    ["talk", "moderator", "moderator"],
    ["panel", "moderator", "moderator"],
    ["fireside", "moderator", "moderator"],
  ] as const)("a %s's %s is its %s", (format, role, expected) => {
    expect(stageRole(format, role)).toBe(expected);
  });
});

describe("the import", () => {
  /** Margaret and Katherine get profiles; the nameless host can't. */
  const decided: Decisions = {
    create: ["usr-Hamilton1", "usr-Johnson1"],
    link: {},
  };

  const opened: Array<PGlite> = [];
  afterAll(() => Promise.all(opened.map((db) => db.close())));

  /** tests/seed.sql, with the upcoming event on another calendar. */
  const database = async () => {
    const db = await seededDatabase();
    opened.push(db);
    await db.exec(
      `UPDATE events SET luma_event_id = 'evt-partner' WHERE id = 'e0000000-0000-4000-8000-000000000004'`,
    );
    return db;
  };

  const importInto = (
    db: PGlite,
    replies: Readonly<Record<string, ReadonlyArray<Reply>>> = {
      "evt-react": [{ body: managed }],
      "evt-partner": [{ body: viewed }],
    },
    options: {
      dryRun?: boolean;
      env?: Record<string, string>;
      decisions?: Decisions;
    } = {},
  ) => {
    const luma = fakeApi(replies);
    return Effect.runPromiseExit(
      settle(
        LumaPeopleSync.use((sync) =>
          sync.run({
            dryRun: options.dryRun ?? false,
            decisions: options.decisions ?? decided,
          }),
        ),
      ).pipe(
        Effect.provide(
          LumaPeopleSync.layer.pipe(
            Layer.provide(LumaApi.layer),
            Layer.provide(
              Layer.mergeAll(luma.layer, configFrom(options.env ?? withKey)),
            ),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    ).then((exit) => ({ exit, requests: luma.requests }));
  };

  const imported = async (
    ...args: Parameters<typeof importInto>
  ): Promise<Extract<PeopleImport, { _tag: "Planned" }>> => {
    const { exit } = await importInto(...args);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    if (exit.value._tag !== "Planned") throw new Error("skipped");
    return exit.value;
  };

  const people = async (db: PGlite) =>
    (
      await db.query<{
        event: string;
        name: string;
        role: string;
        position: number;
        source: string;
      }>(`
        SELECT e.luma_event_id AS event, p.name, ep.role, ep.position, ep.source
        FROM event_people ep
        JOIN events e ON e.id = ep.event_id
        JOIN profiles p ON p.id = ep.profile_id
        ORDER BY e.luma_event_id, ep.role, ep.position, p.name`)
    ).rows;

  const lumaProfiles = async (db: PGlite) =>
    (
      await db.query<{
        name: string;
        lumaUserId: string;
        title: string;
        bio: string;
        profileType: string;
        photo: string | null;
      }>(`
        SELECT name, luma_user_id AS "lumaUserId", title, bio,
          profile_type::text AS "profileType", photo_source_url AS photo
        FROM profiles WHERE luma_user_id IS NOT NULL ORDER BY luma_user_id`)
    ).rows;

  const counts = async (db: PGlite) =>
    (
      await db.query<{
        event: string;
        going: number | null;
        checkedIn: number | null;
      }>(`
        SELECT luma_event_id AS event, luma_guest_count AS going,
          luma_checked_in_count AS "checkedIn"
        FROM events WHERE luma_event_id IS NOT NULL ORDER BY luma_event_id`)
    ).rows;

  const snapshot = async (db: PGlite) => ({
    people: await people(db),
    profiles: (await db.query(`SELECT * FROM profiles ORDER BY id`)).rows,
    events: (await db.query(`SELECT * FROM events ORDER BY id`)).rows,
  });

  test("does nothing without LUMA_API_KEY", async () => {
    const db = await database();
    const before = await snapshot(db);
    const { exit, requests } = await importInto(db, undefined, { env: {} });
    expect(exit).toEqual(
      Exit.succeed({ _tag: "Skipped", reason: "LUMA_API_KEY is not set" }),
    );
    expect(requests).toEqual([]);
    expect(await snapshot(db)).toEqual(before);
  });

  test("without decisions, writes the hosts it can match and lists the rest", async () => {
    const db = await database();
    const result = await imported(db, undefined, { decisions: noDecisions });
    expect(result.written).toEqual({
      linked: 3,
      created: 0,
      written: 3,
      removed: 0,
      counted: 1,
    });
    expect(await people(db)).toEqual([
      {
        event: "evt-partner",
        name: "Future Speaker",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Ada Lovelace",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Grace Hopper",
        role: "organizer",
        position: 0,
        source: "luma",
      },
    ]);
    expect(formatImport(result).split("\n").slice(-4)).toEqual([
      "evt-partner",
      "  not imported: Margaret Hamilton (usr-Hamilton1): no profile has this name",
      "  matched by name: Future Speaker (usr-Future1) is profile b0000000-0000-4000-8000-000000000005",
      "Hosts not imported wait for a decision: run again with --create <Luma user id> to make them a profile, or --link <Luma user id>=<profile id> if they have one.",
    ]);
  });

  test("decisions it cannot carry out fail the import, which writes nothing", async () => {
    const db = await database();
    const before = await snapshot(db);
    const { exit } = await importInto(db, undefined, {
      decisions: { create: ["usr-Nobody"], link: {} },
    });
    const error = failure(exit);
    expect(error).toEqual(
      new PeopleDecisionError({
        problems: [
          "usr-Nobody is not a host of any event Luma showed us; nothing to decide",
        ],
      }),
    );
    expect((error as PeopleDecisionError).message).toBe(
      "Nothing was written; these decisions cannot be carried out:\n  usr-Nobody is not a host of any event Luma showed us; nothing to decide",
    );
    expect(await snapshot(db)).toEqual(before);
  });

  test("writes each published event's hosts and counts, matching and creating profiles", async () => {
    const db = await database();
    const result = await imported(db);
    // The draft is never asked about.
    expect(result.asked).toBe(2);
    expect(result.unavailable).toEqual([]);
    expect(result.written).toEqual({
      linked: 3,
      created: 2,
      written: 6,
      removed: 0,
      counted: 1,
    });
    expect(await people(db)).toEqual([
      {
        event: "evt-partner",
        name: "Margaret Hamilton",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      {
        event: "evt-partner",
        name: "Future Speaker",
        role: "co-host",
        position: 1,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Margaret Hamilton",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Ada Lovelace",
        role: "co-host",
        position: 1,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Katherine Johnson",
        role: "co-host",
        position: 2,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Grace Hopper",
        role: "organizer",
        position: 0,
        source: "luma",
      },
    ]);
    expect(await lumaProfiles(db)).toEqual([
      // Existing profiles keep everything but gain their Luma user id.
      {
        name: "Future Speaker",
        lumaUserId: "usr-Future1",
        title: "Soon",
        bio: "Next month.",
        profileType: "member",
        photo: null,
      },
      {
        name: "Margaret Hamilton",
        lumaUserId: "usr-Hamilton1",
        title: "",
        bio: "",
        profileType: "member",
        photo: "https://images.lumacdn.com/avatars/mh/margaret.jpg",
      },
      {
        name: "Grace Hopper",
        lumaUserId: "usr-Hopper1",
        title: "Admiral",
        bio: "",
        profileType: "organizer",
        photo: null,
      },
      // A stock avatar is no photo.
      {
        name: "Katherine Johnson",
        lumaUserId: "usr-Johnson1",
        title: "",
        bio: "",
        profileType: "member",
        photo: null,
      },
      {
        name: "Ada Lovelace",
        lumaUserId: "usr-Lovelace1",
        title: "Engineer",
        bio: "Writes compilers.",
        profileType: "member",
        photo: null,
      },
    ]);
    expect(await counts(db)).toEqual([
      { event: "evt-draft", going: null, checkedIn: null },
      { event: "evt-partner", going: null, checkedIn: null },
      { event: "evt-react", going: 183, checkedIn: 141 },
    ]);
    expect(formatImport(result)).toBe(
      [
        "Asked Luma about 2 published events; 0 not shown to us.",
        "Planned: 6 hosts across 2 events, 3 profiles to link, 2 to create, guest counts for 1 event.",
        "Wrote: 6 host rows added or reordered, 0 removed, 3 profiles linked, 2 created, guest counts changed for 1 event.",
        "To review:",
        "evt-react",
        "  matched by name: Grace Hopper (usr-Hopper1) is profile b0000000-0000-4000-8000-000000000002",
        "  new profile: Margaret Hamilton (usr-Hamilton1)",
        "  matched by name: Ada Lovelace (usr-Lovelace1) is profile b0000000-0000-4000-8000-000000000001",
        "  new profile: Katherine Johnson (usr-Johnson1)",
        "  not imported: (no name) (usr-Nameless1): Luma shows no name for this host",
        "evt-partner",
        "  new profile: Margaret Hamilton (usr-Hamilton1)",
        "  matched by name: Future Speaker (usr-Future1) is profile b0000000-0000-4000-8000-000000000005",
        "Hosts not imported wait for a decision: run again with --create <Luma user id> to make them a profile, or --link <Luma user id>=<profile id> if they have one.",
      ].join("\n"),
    );
  });

  test("a second import with nothing new changes nothing", async () => {
    const db = await database();
    await imported(db);
    const before = await snapshot(db);
    const again = await imported(db);
    expect(again.written).toEqual({
      linked: 0,
      created: 0,
      written: 0,
      removed: 0,
      counted: 0,
    });
    expect(again.plan.review.map((review) => review._tag)).toEqual([
      "Unmatched",
    ]);
    expect(await snapshot(db)).toEqual(before);
  });

  test("a dry run plans the same import and writes nothing", async () => {
    const db = await database();
    const before = await snapshot(db);
    const dry = await imported(db, undefined, { dryRun: true });
    expect(dry.written).toBeNull();
    expect(dry.plan.people).toHaveLength(6);
    expect(formatImport(dry).split("\n")[1]).toStartWith(
      "Would write: 6 hosts",
    );
    expect(await snapshot(db)).toEqual(before);
  });

  test("follows Luma's hosts, and never touches what the site wrote", async () => {
    const db = await database();
    await imported(db);
    await db.exec(`
      INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
        ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'mc', 0, 'site', now()),
        ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'mc', 1, 'site', now());
      UPDATE event_people SET source = 'site'
        WHERE profile_id = (SELECT id FROM profiles WHERE luma_user_id = 'usr-Johnson1');
    `);
    // Margaret and Katherine stop hosting; Ada moves up; counts change.
    const fewer = JSON.parse(managed) as {
      hosts: Array<{ id: string }>;
      guest_counts: { approved: { guests: number } };
    };
    fewer.hosts = fewer.hosts.filter(
      (host) => host.id !== "usr-Hamilton1" && host.id !== "usr-Johnson1",
    );
    fewer.guest_counts.approved.guests = 184;
    const result = await imported(
      db,
      {
        "evt-react": [{ body: JSON.stringify(fewer) }],
        "evt-partner": [{ body: viewed }],
      },
      { decisions: noDecisions },
    );
    expect(result.written).toMatchObject({
      written: 1,
      removed: 1,
      counted: 1,
    });
    expect(
      (await people(db)).filter((row) => row.event === "evt-react"),
    ).toEqual([
      {
        event: "evt-react",
        name: "Ada Lovelace",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      // The site's rows stay, Katherine's included, though Luma dropped her.
      {
        event: "evt-react",
        name: "Katherine Johnson",
        role: "co-host",
        position: 2,
        source: "site",
      },
      {
        event: "evt-react",
        name: "Linus",
        role: "mc",
        position: 0,
        source: "site",
      },
      {
        event: "evt-react",
        name: "Ada Lovelace",
        role: "mc",
        position: 1,
        source: "site",
      },
      {
        event: "evt-react",
        name: "Grace Hopper",
        role: "organizer",
        position: 0,
        source: "luma",
      },
    ]);
    expect((await counts(db)).find((row) => row.event === "evt-react")).toEqual(
      {
        event: "evt-react",
        going: 184,
        checkedIn: 141,
      },
    );
  });

  test("an event Luma no longer shows keeps its hosts and counts", async () => {
    const db = await database();
    await imported(db);
    const before = await snapshot(db);
    const result = await imported(
      db,
      {
        "evt-react": [{ status: 404 }],
        "evt-partner": [{ body: viewed }],
      },
      { decisions: noDecisions },
    );
    expect(result.unavailable).toEqual(["evt-react"]);
    expect(await snapshot(db)).toEqual(before);
  });

  test("a failure asking about any event writes nothing", async () => {
    const db = await database();
    const before = await snapshot(db);
    const { exit } = await importInto(db, {
      "evt-react": [{ body: managed }],
      "evt-partner": [{ status: 401 }],
    });
    expect(failure(exit)).toEqual(
      new LumaRejected({ status: 401, resource: "event" }),
    );
    expect(await snapshot(db)).toEqual(before);
  });

  test("a profile holding a host's Luma user id is that host, whatever its name", async () => {
    const db = await database();
    await db.exec(
      `UPDATE profiles SET luma_user_id = 'usr-Hamilton1' WHERE id = 'b0000000-0000-4000-8000-000000000007'`,
    );
    const result = await imported(db);
    expect(result.plan.newProfiles.map((p) => p.lumaUserId)).toEqual([
      "usr-Johnson1",
    ]);
    expect(
      (await people(db)).filter((row) => row.name === "Unattached"),
    ).toEqual([
      {
        event: "evt-partner",
        name: "Unattached",
        role: "co-host",
        position: 0,
        source: "luma",
      },
      {
        event: "evt-react",
        name: "Unattached",
        role: "co-host",
        position: 0,
        source: "luma",
      },
    ]);
  });
});
