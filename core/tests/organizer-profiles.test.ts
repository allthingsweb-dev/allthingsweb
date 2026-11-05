import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import {
  grantStatements as readerGrants,
  SITE_READER,
} from "../../infra/scripts/site-reader.ts";
import {
  organizerCheckDays,
  PeopleRecord,
  profileCheck,
  staleHosts,
  staleLine,
} from "../src/organizer-profiles.ts";
import type { PeopleFile } from "../src/people-enrichment.ts";
import { Planning } from "../src/planning/planning.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import {
  clockAt,
  clockLayer,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * The hosts' own profiles (src/organizer-profiles.ts): fresh only with a
 * title and a bio read in core/backfill/people.json within 90 days;
 * readiness blocks a draft on any organizer or co-host who isn't, and
 * `people stale --organizers` lists them for every evening of ours ahead.
 * The test clock is 2026-10-03.
 */

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const source = "https://example.com/about";

/** Ada's title and bio, each read on `title` and `bio`. */
const adaRead = (title: string, bio = title): PeopleFile => [
  {
    profileId: ada,
    name: "Ada Lovelace",
    title: { value: "Engineer", source, read: title },
    bio: { value: "Writes compilers.", source, read: bio },
  },
];

describe("a host's profile check", () => {
  test("is fresh with a title and a bio each read within 90 days", () => {
    expect(organizerCheckDays).toBe(90);
    expect(profileCheck(adaRead("2026-07-06"), ada, "2026-10-03")).toEqual({
      fresh: true,
      title: "2026-07-06",
      bio: "2026-07-06",
    });
  });

  test("is stale with either read 90 days ago or more", () => {
    const old = profileCheck(
      adaRead("2026-10-01", "2026-07-05"),
      ada,
      "2026-10-03",
    );
    expect(old.fresh).toBe(false);
    expect(staleLine(old)).toBe("title read 2026-10-01, bio read 2026-07-05");
  });

  test("is stale with a read dated ahead, or on no real day: a bad date fails closed", () => {
    for (const read of [
      "2063-11-01",
      "2026-10-04",
      "2026-13-01",
      "2026-02-30",
    ]) {
      expect(profileCheck(adaRead(read), ada, "2026-10-03").fresh).toBe(false);
    }
    expect(profileCheck(adaRead("2026-10-03"), ada, "2026-10-03").fresh).toBe(
      true,
    );
  });

  test("is stale with no entry, or an entry missing either fact", () => {
    const none = profileCheck([], ada, "2026-10-03");
    expect(none).toEqual({ fresh: false, title: null, bio: null });
    expect(staleLine(none)).toBe("title never checked, bio never checked");
    const titleOnly: PeopleFile = [
      {
        profileId: ada,
        name: "Ada Lovelace",
        title: { value: "Engineer", source, read: "2026-10-01" },
      },
    ];
    expect(profileCheck(titleOnly, ada, "2026-10-03").fresh).toBe(false);
  });

  test("the repository's file decodes as the record readiness reads", async () => {
    const { file } = await Effect.runPromise(
      PeopleRecord.use((record) => Effect.succeed(record)).pipe(
        Effect.provide(PeopleRecord.layer),
      ),
    );
    expect(file.length).toBeGreaterThan(0);
  });
});

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

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

const draft = "2026-09-01-draft-night";

/** Readiness's checks of hosts' profiles on the draft, with `file` as the record. */
const hostChecks = (file: PeopleFile) =>
  Effect.runPromise(
    Readiness.use((r) => r.report({ _tag: "Event", slug: draft })).pipe(
      Effect.provide(
        Readiness.layerWith(PeopleRecord.fromFile(file)).pipe(
          Layer.provideMerge(Planning.layer),
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  ).then((report) => ({
    ready: report.ready,
    checks: report.checks
      .filter((entry) => entry.kind === "organizer-profile")
      .map((entry) => `${entry.level} ${entry.subject}: ${entry.message}`),
  }));

describe("readiness", () => {
  beforeEach(async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z'
      WHERE slug = '${draft}'`);
    // Ada organizes and MCs, Grace co-hosts: Ada is checked once.
    await plan((p) =>
      p.setDraftLineup(draft, [
        { role: "organizer", profile: "Ada Lovelace" },
        { role: "mc", profile: "Ada Lovelace" },
        { role: "co-host", profile: "Grace Hopper" },
      ]),
    );
  });

  test("blocks a draft on each host whose profile wasn't checked lately", async () => {
    const { checks } = await hostChecks(adaRead("2026-06-01"));
    expect(checks).toEqual([
      expect.stringMatching(
        /^blocker Ada Lovelace: Ada Lovelace's title and bio weren't both checked in the last 90 days \(title read 2026-06-01, bio read 2026-06-01\): /,
      ),
      expect.stringMatching(
        /^blocker Grace Hopper: .*\(title never checked, bio never checked\): read them against their own sources, record both in core\/backfill\/people\.json/,
      ),
    ]);
  });

  test("and says nothing of hosts checked within 90 days", async () => {
    const file: PeopleFile = [
      ...adaRead("2026-09-30"),
      {
        profileId: grace,
        name: "Grace Hopper",
        title: { value: "Admiral", source, read: "2026-10-03" },
        bio: { value: "Wrote the first compiler.", source, read: "2026-10-02" },
      },
    ];
    expect((await hostChecks(file)).checks).toEqual([]);
  });

  test("an MC alone isn't a host", async () => {
    await plan((p) =>
      p.setDraftLineup(draft, [{ role: "mc", profile: "Grace Hopper" }]),
    );
    expect((await hostChecks([])).checks).toEqual([]);
  });
});

describe("people stale --organizers", () => {
  test("judges by San Francisco's day, as readiness does", async () => {
    // 00:30 UTC on 2026-10-04 is still 2026-10-03 in San Francisco: a read
    // on 2026-07-06 is 89 days old there, and fresh, as readiness has it.
    await db.exec(`INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000004', '${ada}', 'organizer', 0, 'site', now())`);
    const stale = await Effect.runPromise(
      staleHosts(adaRead("2026-07-06")).pipe(
        Effect.provide(sqlLayer(db)),
        Effect.provide(clockAt(DateTime.makeUnsafe("2026-10-04T00:30:00Z"))),
      ),
    );
    // And it says the day it judged by, which `people stale` prints as
    // `organizersToday`: a check recorded with it counts at once.
    expect(stale).toEqual({ today: "2026-10-03", hosts: [] });
    const recorded = await Effect.runPromise(
      staleHosts(adaRead(stale.today)).pipe(
        Effect.provide(sqlLayer(db)),
        Effect.provide(clockAt(DateTime.makeUnsafe("2026-10-04T00:30:00Z"))),
      ),
    );
    expect(recorded.hosts).toEqual([]);
  });

  const run = (file: PeopleFile) =>
    Effect.runPromise(
      staleHosts(file).pipe(
        Effect.map((stale) => stale.hosts),
        Effect.provide(sqlLayer(db)),
        Effect.provide(clockLayer),
      ),
    );

  test("lists the stale hosts of evenings of ours ahead, with their evenings", async () => {
    // The upcoming evening, and one already over: only the first counts.
    await db.exec(`INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000004', '${ada}', 'organizer', 0, 'site', now()),
      ('e0000000-0000-4000-8000-000000000004', '${grace}', 'co-host', 1, 'site', now()),
      ('e0000000-0000-4000-8000-000000000001', '${grace}', 'organizer', 0, 'site', now())`);
    expect(await run(adaRead("2026-09-30"))).toEqual([
      {
        profileId: grace,
        name: "Grace Hopper",
        title: null,
        bio: null,
        evenings: ["2026-11-05-upcoming"],
      },
    ]);
    expect((await run([])).map((host) => host.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  test("as site_reader, reads the published lineups only", async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z'
      WHERE slug = '${draft}'`);
    await plan((p) =>
      p.setDraftLineup(draft, [{ role: "co-host", profile: "Ada Lovelace" }]),
    );
    await db.exec(`INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000004', '${grace}', 'organizer', 0, 'site', now())`);
    const owner: Statements = {
      unsafe: async (query, values) =>
        (await db.query(query, values === undefined ? [] : [...values])).rows,
    };
    await provisionLoginRole(owner, SITE_READER, "test-only");
    for (const statement of readerGrants()) await db.exec(statement);
    await db.exec(`SET ROLE ${SITE_READER}`);
    try {
      expect((await run([])).map((host) => host.name)).toEqual([
        "Grace Hopper",
      ]);
    } finally {
      await db.exec("RESET ROLE");
    }
    // As the owner, the draft's planned co-host joins.
    expect((await run([])).map((host) => host.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  test("adds a draft's lineup as planned, as a role that may read planning", async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z'
      WHERE slug = '${draft}'`);
    await plan((p) =>
      p.setDraftLineup(draft, [{ role: "co-host", profile: "Ada Lovelace" }]),
    );
    expect(await run([])).toEqual([
      {
        profileId: ada,
        name: "Ada Lovelace",
        title: null,
        bio: null,
        evenings: [draft],
      },
    ]);
  });
});
